import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { Message, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  IMAGE_EXTENSION_TO_MIME_TYPE,
  MAX_IMAGE_SIZE_BYTES,
  MAX_MEDIA_ALBUM_ITEMS,
  MAX_VIDEO_SIZE_BYTES,
} from '../uploads/media-upload.constants';
import { matchesFileSignature } from '../uploads/file-signature.util';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { SendMediaMessageDto } from './dto/send-media-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

/** Une entrée de `SendMediaMessageDto.meta` — jamais interprétée avant validation champ par champ, voir readMeta(). */
interface MediaItemMeta {
  fileName?: unknown;
  durationSeconds?: unknown;
  width?: unknown;
  height?: unknown;
}

function readMeta(raw: string | undefined, count: number): MediaItemMeta[] {
  if (!raw) return new Array<MediaItemMeta>(count).fill({});
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Array<MediaItemMeta>(count).fill({});
    return parsed as MediaItemMeta[];
  } catch {
    return new Array<MediaItemMeta>(count).fill({});
  }
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

const DEFAULT_PAGE_SIZE = 30;
// Plus petit que DEFAULT_PAGE_SIZE : la galerie "Médias partagés" occupe un
// panneau latéral étroit (voir InfoPanel), pas le fil principal — une
// grille à 2 colonnes de 8 tuiles tient sans faire défiler la page entière.
const MEDIA_PREVIEW_PAGE_SIZE = 8;

const MESSAGE_READS_SELECT = { userId: true, readAt: true } satisfies Prisma.MessageReadSelect;
const MESSAGE_ATTACHMENTS_SELECT = {
  id: true,
  mimeType: true,
  sizeBytes: true,
  type: true,
  fileName: true,
  durationSeconds: true,
  width: true,
  height: true,
} satisfies Prisma.AttachmentSelect;
const MESSAGE_INCLUDE = {
  reads: { select: MESSAGE_READS_SELECT },
  // `position` explicite : Prisma ne garantit pas l'ordre d'un include sans
  // `orderBy` — indispensable pour qu'un album se réaffiche toujours dans
  // l'ordre choisi par l'expéditeur.
  attachments: { select: MESSAGE_ATTACHMENTS_SELECT, orderBy: { position: 'asc' } },
} satisfies Prisma.MessageInclude;

type MessageAttachment = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  type: 'IMAGE' | 'VIDEO';
  fileName: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

type MessageWithReads = Message & {
  reads: { userId: string; readAt: Date }[];
  attachments?: MessageAttachment[];
};

function toMessageDto(message: MessageWithReads) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    text: message.text,
    replyToId: message.replyToId,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
    // Conversations DIRECT uniquement (MVP) : au plus un autre membre peut
    // avoir lu le message, donc un seul accusé de lecture possible. Des
    // conversations de groupe demanderaient une liste par lecteur.
    readAt: message.reads[0]?.readAt ?? null,
    // URL authentifiée, jamais la clé de stockage interne (même principe que
    // VoiceService/StatusesService) — vide pour un message sans pièce jointe.
    attachments: (message.attachments ?? []).map(toAttachmentDto),
    createdAt: message.createdAt,
  };
}

function toAttachmentDto(a: MessageAttachment) {
  return {
    id: a.id,
    url: `/api/messages/attachments/${a.id}`,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    type: a.type,
    fileName: a.fileName,
    durationSeconds: a.durationSeconds,
    width: a.width,
    height: a.height,
  };
}

export type MessageDto = ReturnType<typeof toMessageDto>;
export type MediaAttachmentDto = ReturnType<typeof toAttachmentDto>;

export interface AttachmentStream {
  stream: ReadStream;
  mimeType: string;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async send(userId: string, dto: CreateMessageDto): Promise<MessageDto> {
    await this.assertMembership(userId, dto.conversationId);

    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: dto.replyToId } });
      if (!replyTarget || replyTarget.conversationId !== dto.conversationId) {
        throw new BadRequestException(
          'Le message auquel vous répondez est introuvable dans cette conversation.',
        );
      }
    }

    const recipients = await this.otherMemberIds(dto.conversationId, userId);
    // "Livré" dès la création si au moins un destinataire est actuellement
    // connecté (présence réelle, phase 6). Pas de rattrapage rétroactif à la
    // reconnexion pour ce MVP : un message envoyé à un destinataire hors
    // ligne reste "envoyé" jusqu'à ce qu'il le lise — la lecture implique
    // alors la livraison (voir markConversationRead).
    const deliveredAt = recipients.some((id) => this.presence.isOnline(id)) ? new Date() : null;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: dto.conversationId,
          senderId: userId,
          type: 'TEXT',
          text: dto.text,
          replyToId: dto.replyToId,
          deliveredAt,
        },
        include: MESSAGE_INCLUDE,
      }),
      // Fait remonter la conversation en tête de liste (GET /conversations
      // trie par updatedAt) — sans ça une conversation muette resterait
      // coincée à sa date de création.
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    this.events.emitToUsers(recipients, 'message:new', toMessageDto(message));

    // Centre de notifications (badge, historique) — indépendant de la
    // diffusion temps réel ci-dessus : reste utile même si le destinataire
    // n'était pas connecté pour recevoir l'événement WebSocket.
    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.create(recipientId, 'NEW_MESSAGE', {
          conversationId: dto.conversationId,
          messageId: message.id,
          senderId: userId,
          preview: dto.text.slice(0, 120),
        }),
      ),
    );

    return toMessageDto(message);
  }

  async sendImage(
    userId: string,
    dto: SendImageMessageDto,
    file: Express.Multer.File | undefined,
  ): Promise<MessageDto> {
    if (!file || file.size === 0) {
      throw new BadRequestException('Aucune image reçue.');
    }
    const extension = ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Format d'image non supporté : "${file.mimetype}". Formats acceptés : ${Object.keys(ALLOWED_IMAGE_MIME_TYPES).join(', ')}.`,
      );
    }
    // Le Content-Type d'un formulaire multipart est choisi par le client et
    // ne garantit rien sur le contenu réel du fichier (audit de sécurité) —
    // on vérifie les octets de signature avant d'aller plus loin.
    if (!matchesFileSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        `Le contenu du fichier ne correspond pas au format déclaré ("${file.mimetype}").`,
      );
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException(
        `L'image est trop volumineuse (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
          MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
        } Mo).`,
      );
    }

    await this.assertMembership(userId, dto.conversationId);

    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: dto.replyToId } });
      if (!replyTarget || replyTarget.conversationId !== dto.conversationId) {
        throw new BadRequestException(
          'Le message auquel vous répondez est introuvable dans cette conversation.',
        );
      }
    }

    const recipients = await this.otherMemberIds(dto.conversationId, userId);
    const deliveredAt = recipients.some((id) => this.presence.isOnline(id)) ? new Date() : null;

    // Enregistré sur disque avant l'écriture en base (même ordre que
    // VoiceService/StatusesService) : en cas d'échec de la transaction, un
    // fichier orphelin sur disque est un moindre mal qu'une ligne en base
    // pointant vers un fichier qui n'a jamais été écrit.
    const stored = await this.storage.save(file.buffer, 'attachment', extension);

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: dto.conversationId,
          senderId: userId,
          type: 'IMAGE',
          text: dto.text,
          replyToId: dto.replyToId,
          deliveredAt,
          attachments: {
            create: {
              ownerId: userId,
              // Champ historiquement nommé "url" en base (schéma jamais
              // migré vers *StorageKey comme VoiceMessage/Status — voir
              // PHASES.md) : contient en réalité une clé de stockage
              // interne, jamais exposée telle quelle (voir toMessageDto).
              url: stored.key,
              mimeType: file.mimetype,
              sizeBytes: stored.sizeBytes,
            },
          },
        },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    this.events.emitToUsers(recipients, 'message:new', toMessageDto(message));

    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.create(recipientId, 'NEW_MESSAGE', {
          conversationId: dto.conversationId,
          messageId: message.id,
          senderId: userId,
          preview: dto.text?.slice(0, 120) ?? '📷 Photo',
        }),
      ),
    );

    return toMessageDto(message);
  }

  /**
   * Un ou plusieurs médias (image/vidéo) envoyés en une seule action —
   * "MediaBatch/Album" : un seul Message (type MEDIA_ALBUM), un Attachment
   * par fichier, jamais un message par fichier. Remplace `sendImage` pour
   * tout nouvel envoi, même un seul fichier — c'est au frontend d'adapter
   * l'affichage selon `attachments.length` (voir toMessageDto).
   */
  async sendMedia(
    userId: string,
    dto: SendMediaMessageDto,
    files: Express.Multer.File[] | undefined,
  ): Promise<MessageDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun média reçu.');
    }
    if (files.length > MAX_MEDIA_ALBUM_ITEMS) {
      throw new BadRequestException(
        `Un album accepte au maximum ${MAX_MEDIA_ALBUM_ITEMS} fichiers.`,
      );
    }

    // Validation avant toute écriture (disque ou base) : un seul fichier
    // invalide doit rejeter tout l'album, jamais en envoyer une partie.
    for (const file of files) {
      const isImage = Boolean(ALLOWED_IMAGE_MIME_TYPES[file.mimetype]);
      const isVideo = Boolean(ALLOWED_VIDEO_MIME_TYPES[file.mimetype]);
      if (!isImage && !isVideo) {
        throw new BadRequestException(
          `Format non supporté : "${file.mimetype}". Formats acceptés : ${[
            ...Object.keys(ALLOWED_IMAGE_MIME_TYPES),
            ...Object.keys(ALLOWED_VIDEO_MIME_TYPES),
          ].join(', ')}.`,
        );
      }
      // Voir sendImage ci-dessus : le Content-Type déclaré ne garantit rien
      // sur le contenu réel du fichier.
      if (!matchesFileSignature(file.buffer, file.mimetype)) {
        throw new BadRequestException(
          `"${file.originalname}" : le contenu du fichier ne correspond pas au format déclaré ("${file.mimetype}").`,
        );
      }
      const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
      if (file.size > maxSize) {
        throw new BadRequestException(
          `"${file.originalname}" est trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
            maxSize / (1024 * 1024)
          } Mo).`,
        );
      }
    }

    await this.assertMembership(userId, dto.conversationId);

    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: dto.replyToId } });
      if (!replyTarget || replyTarget.conversationId !== dto.conversationId) {
        throw new BadRequestException(
          'Le message auquel vous répondez est introuvable dans cette conversation.',
        );
      }
    }

    const recipients = await this.otherMemberIds(dto.conversationId, userId);
    const deliveredAt = recipients.some((id) => this.presence.isOnline(id)) ? new Date() : null;
    const metaByIndex = readMeta(dto.meta, files.length);

    // Enregistrés sur disque avant l'écriture en base (même ordre que pour
    // un message IMAGE seul) : en cas d'échec de la transaction, des
    // fichiers orphelins sur disque sont un moindre mal qu'une ligne en
    // base pointant vers un fichier jamais écrit.
    const stored = await Promise.all(
      files.map(async (file, index) => {
        const isVideo = Boolean(ALLOWED_VIDEO_MIME_TYPES[file.mimetype]);
        const extension = isVideo
          ? ALLOWED_VIDEO_MIME_TYPES[file.mimetype]
          : ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
        const savedFile = await this.storage.save(file.buffer, 'attachment', extension);
        const meta = metaByIndex[index] ?? {};
        return {
          ownerId: userId,
          url: savedFile.key,
          mimeType: file.mimetype,
          sizeBytes: savedFile.sizeBytes,
          type: isVideo ? ('VIDEO' as const) : ('IMAGE' as const),
          fileName: typeof meta.fileName === 'string' ? meta.fileName.slice(0, 255) : null,
          // Durée jamais pertinente pour une image, même si le client en fournissait une par erreur.
          durationSeconds: isVideo ? readPositiveInt(meta.durationSeconds) : null,
          width: readPositiveInt(meta.width),
          height: readPositiveInt(meta.height),
          position: index,
        };
      }),
    );

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: dto.conversationId,
          senderId: userId,
          type: 'MEDIA_ALBUM',
          text: dto.text,
          replyToId: dto.replyToId,
          deliveredAt,
          attachments: { create: stored },
        },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    this.events.emitToUsers(recipients, 'message:new', toMessageDto(message));

    const videoCount = stored.filter((a) => a.type === 'VIDEO').length;
    const preview =
      dto.text?.slice(0, 120) ??
      (stored.length > 1 ? `📷 ${stored.length} médias` : videoCount > 0 ? '🎥 Vidéo' : '📷 Photo');
    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.create(recipientId, 'NEW_MESSAGE', {
          conversationId: dto.conversationId,
          messageId: message.id,
          senderId: userId,
          preview,
        }),
      ),
    );

    return toMessageDto(message);
  }

  /** Streame une pièce jointe — réservé aux membres actifs de la conversation du message parent (section 23). */
  async streamAttachment(userId: string, attachmentId: string): Promise<AttachmentStream> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { message: true },
    });
    if (!attachment || !attachment.message) {
      throw new NotFoundException('Pièce jointe introuvable.');
    }
    await this.assertMembership(userId, attachment.message.conversationId);

    if (!(await this.storage.exists(attachment.url))) {
      throw new NotFoundException('Fichier introuvable.');
    }

    const extension = attachment.url.split('.').pop() ?? '';
    return {
      stream: this.storage.createReadStream(attachment.url),
      mimeType: IMAGE_EXTENSION_TO_MIME_TYPE[extension] ?? attachment.mimeType,
    };
  }

  async list(userId: string, conversationId: string, query: ListMessagesQueryDto) {
    await this.assertMembership(userId, conversationId);

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;

    // Renvoyés dans l'ordre chronologique (le plus ancien d'abord) : c'est
    // l'ordre d'affichage attendu par le frontend.
    return {
      items: page.reverse().map(toMessageDto),
      nextCursor: nextCursor ?? null,
    };
  }

  /**
   * Galerie "Médias partagés" (InfoPanel) — les pièces jointes IMAGE/VIDEO
   * de la conversation, les plus récentes d'abord, jamais celles d'un
   * message supprimé. Remplace l'ancien contenu factice (dégradés codés en
   * dur, jamais de vraie donnée) constaté en testant l'interface.
   *
   * Paginée par curseur comme le reste de l'appli (jamais une seule requête
   * qui renverrait tout l'historique média d'une conversation : une
   * conversation ancienne avec des centaines/milliers de photos rendrait
   * une liste plate ingérable, aussi bien pour le serveur que pour
   * l'affichage — voir MEDIA_PREVIEW_PAGE_SIZE, volontairement petit pour
   * un panneau latéral compact).
   */
  async listMedia(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit = MEDIA_PREVIEW_PAGE_SIZE,
  ): Promise<{ items: MediaAttachmentDto[]; nextCursor: string | null }> {
    await this.assertMembership(userId, conversationId);

    const rows = await this.prisma.attachment.findMany({
      where: { message: { conversationId, deletedAt: null } },
      select: MESSAGE_ATTACHMENTS_SELECT,
      orderBy: { message: { createdAt: 'desc' } },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toAttachmentDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Recherche texte au sein d'une conversation (bouton "Rechercher" du
   * cahier des charges, jusqu'ici marqué "bientôt disponible") — jamais un
   * message supprimé (son `text` est déjà vidé en base, donc naturellement
   * exclu d'un `contains`), jamais un message vocal/média sans légende
   * correspondante. Paginée par curseur comme le reste de l'appli.
   */
  async search(
    userId: string,
    conversationId: string,
    q: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<{ items: MessageDto[]; nextCursor: string | null }> {
    await this.assertMembership(userId, conversationId);

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        text: { contains: q, mode: 'insensitive' },
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toMessageDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Fenêtre de messages centrée sur un résultat de recherche (voir
   * ChatWindow → clic sur un résultat) — jusqu'à `limit` messages plus
   * anciens et jusqu'à `limit` plus récents que le message ciblé, tous deux
   * inclus. Permet d'afficher son contexte immédiat sans avoir à recharger
   * tout l'historique intermédiaire depuis le début de la conversation.
   */
  async listAroundMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<{ items: MessageDto[]; matchedMessageId: string; hasOlder: boolean }> {
    await this.assertMembership(userId, conversationId);

    const target = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, createdAt: true },
    });
    if (!target || target.conversationId !== conversationId) {
      throw new NotFoundException('Message introuvable.');
    }

    const [olderAndSelf, newer] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId, createdAt: { lte: target.createdAt } },
        include: MESSAGE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      }),
      this.prisma.message.findMany({
        where: { conversationId, createdAt: { gt: target.createdAt } },
        include: MESSAGE_INCLUDE,
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    ]);

    const hasOlder = olderAndSelf.length > limit;
    const olderPage = hasOlder ? olderAndSelf.slice(0, limit) : olderAndSelf;

    return {
      // Ordre chronologique (le plus ancien d'abord), comme list() —
      // `olderPage` est descendant, on le renverse ; `newer` est déjà ascendant.
      items: [...olderPage.reverse(), ...newer].map(toMessageDto),
      matchedMessageId: messageId,
      hasOlder,
    };
  }

  async edit(userId: string, messageId: string, dto: UpdateMessageDto): Promise<MessageDto> {
    const message = await this.requireOwnedMessage(userId, messageId, 'modifier');

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { text: dto.text, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(recipients, 'message:updated', toMessageDto(updated));

    return toMessageDto(updated);
  }

  async remove(userId: string, messageId: string): Promise<MessageDto> {
    const message = await this.requireOwnedMessage(userId, messageId, 'supprimer');

    if (message.deletedAt) {
      return toMessageDto({ ...message, reads: [] }); // déjà supprimé : idempotent
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), text: null },
      include: MESSAGE_INCLUDE,
    });

    // Fichier(s) effacés après la mise à jour en base (même ordre que
    // VoiceService.remove) : jamais de fichier référencé par une ligne qui
    // n'existe plus côté suppression, best-effort si le disque échoue.
    if ((updated.attachments ?? []).length > 0) {
      const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
      await Promise.all(attachments.map((a) => this.storage.delete(a.url)));
    }

    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(recipients, 'message:deleted', {
      id: updated.id,
      conversationId: updated.conversationId,
    });

    return toMessageDto(updated);
  }

  /**
   * Marque comme lus tous les messages non-lus reçus dans la conversation
   * (jamais ses propres messages). La lecture implique la livraison : les
   * messages encore marqués `deliveredAt: null` la reçoivent au passage.
   */
  async markConversationRead(userId: string, conversationId: string): Promise<{ readAt: Date }> {
    await this.assertMembership(userId, conversationId);

    const unread = await this.prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        deletedAt: null,
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    const readAt = new Date();

    if (unread.length > 0) {
      const ids = unread.map((m) => m.id);
      await this.prisma.$transaction([
        this.prisma.messageRead.createMany({
          data: ids.map((messageId) => ({ messageId, userId, readAt })),
          skipDuplicates: true,
        }),
        this.prisma.message.updateMany({
          where: { id: { in: ids }, deliveredAt: null },
          data: { deliveredAt: readAt },
        }),
        this.prisma.conversationMember.update({
          where: { conversationId_userId: { conversationId, userId } },
          data: { lastReadAt: readAt },
        }),
      ]);

      const recipients = await this.otherMemberIds(conversationId, userId);
      // Le lecteur lui-même est inclus (pas seulement les autres membres) :
      // ses AUTRES appareils connectés (téléphone, autre onglet...) doivent
      // aussi remettre à zéro le badge non-lu de cette conversation — voir
      // chat/page.tsx (section 21-22 du cahier des charges, synchronisation
      // multi-appareils). Le frontend distingue déjà ce cas
      // (`readerId === user.id`) pour ne jamais réappliquer les coches de
      // lecture sur ses propres messages, seulement le badge.
      this.events.emitToUsers([...recipients, userId], 'message:read', {
        conversationId,
        readerId: userId,
        readAt,
      });
    } else {
      // Rien à marquer, mais on avance quand même lastReadAt : ouvrir une
      // conversation déjà lue ne doit jamais la faire réapparaître comme
      // "non lue" à cause d'un décompte basé sur une date figée.
      await this.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadAt: readAt },
      });
    }

    return { readAt };
  }

  /** Charge un message et vérifie que l'appelant est membre de sa conversation ET en est l'auteur. */
  private async requireOwnedMessage(
    userId: string,
    messageId: string,
    action: string,
  ): Promise<Message> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('Message introuvable.');
    }
    // Membre de la conversation ? (section 23) — 404 pour ne rien révéler.
    await this.assertMembership(userId, message.conversationId);
    // Auteur du message ? — 403, car l'appartenance à la conversation est
    // déjà confirmée : pas de fuite d'information à préciser la raison ici.
    if (message.senderId !== userId) {
      throw new ForbiddenException(`Vous ne pouvez ${action} que vos propres messages.`);
    }
    return message;
  }

  private async assertMembership(userId: string, conversationId: string): Promise<void> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }
  }

  private async otherMemberIds(conversationId: string, excludeUserId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: excludeUserId } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }
}
