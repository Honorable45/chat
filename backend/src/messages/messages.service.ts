import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { Message, MediaStorageProvider, Prisma } from '@prisma/client';
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
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
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
const MESSAGE_REACTIONS_SELECT = {
  userId: true,
  emoji: true,
} satisfies Prisma.ReactionSelect;
const MESSAGE_ATTACHMENTS_SELECT = {
  id: true,
  // "url" ne contient pas une vraie URL malgré son nom (voir schema.prisma) :
  // une clé de fichier local ou un public_id Cloudinary selon storageProvider
  // — nécessaire ici pour que toAttachmentDto sache générer le bon lien.
  url: true,
  storageProvider: true,
  mimeType: true,
  sizeBytes: true,
  type: true,
  fileName: true,
  durationSeconds: true,
  width: true,
  height: true,
} satisfies Prisma.AttachmentSelect;
export const MESSAGE_INCLUDE = {
  reads: { select: MESSAGE_READS_SELECT },
  reactions: { select: MESSAGE_REACTIONS_SELECT },
  mentions: { select: { userId: true } },
  // `position` explicite : Prisma ne garantit pas l'ordre d'un include sans
  // `orderBy` — indispensable pour qu'un album se réaffiche toujours dans
  // l'ordre choisi par l'expéditeur.
  attachments: { select: MESSAGE_ATTACHMENTS_SELECT, orderBy: { position: 'asc' } },
  // Résumé du message cité (section "répondre à un message") — un simple
  // replyToId ne suffit pas au frontend pour afficher l'aperçu cité sans
  // dépendre de la page actuellement chargée (le message cité peut être
  // bien plus ancien). Jamais le message cité en entier (pas ses propres
  // pièces jointes/réactions) : juste de quoi construire un résumé compact.
  replyTo: { select: { id: true, senderId: true, type: true, text: true } },
} satisfies Prisma.MessageInclude;

type MessageAttachment = {
  id: string;
  url: string;
  storageProvider: MediaStorageProvider;
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
  reactions?: { userId: string; emoji: string }[];
  mentions?: { userId: string }[];
  attachments?: MessageAttachment[];
};

export function toMessageDto(message: MessageWithReads, cloudinary: CloudinaryProvider) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    text: message.text,
    // Uniquement renseignés pour type SYSTEM (voir Message.systemAction en
    // base) — jamais de phrase pré-rendue en une seule langue, le frontend
    // reconstruit le texte à partir de l'action + de l'auteur/la cible.
    systemAction: message.systemAction,
    systemTargetUserId: message.systemTargetUserId,
    replyToId: message.replyToId,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
    // Conversations DIRECT uniquement (MVP) : au plus un autre membre peut
    // avoir lu le message, donc un seul accusé de lecture possible. Des
    // conversations de groupe demanderaient une liste par lecteur.
    readAt: message.reads[0]?.readAt ?? null,
    reactions: message.reactions ?? [],
    // Mentions individuelles @nom (jamais pour @everyone, voir
    // mentionsEveryone séparé) — juste les IDs, le frontend résout
    // nom/affichage depuis conversation.members comme pour systemTargetUserId.
    mentions: (message.mentions ?? []).map((m) => m.userId),
    mentionsEveryone: message.mentionsEveryone,
    // URL authentifiée, jamais la clé de stockage interne (même principe que
    // VoiceService/StatusesService) — vide pour un message sans pièce jointe.
    attachments: (message.attachments ?? []).map((a) => toAttachmentDto(a, cloudinary)),
    createdAt: message.createdAt,
  };
}

function toAttachmentDto(a: MessageAttachment, cloudinary: CloudinaryProvider) {
  return {
    id: a.id,
    // CLOUDINARY : lien signé à durée limitée, recalculé à chaque appel —
    // jamais mis en cache au-delà de cette réponse (voir CloudinaryProvider.
    // getSignedUrl). LOCAL : chemin proxy inchangé, streamé via streamAttachment.
    url:
      a.storageProvider === 'CLOUDINARY'
        ? cloudinary.getSignedUrl(a.url, a.type === 'VIDEO' ? 'video' : 'image')
        : `/api/messages/attachments/${a.id}`,
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
    private readonly cloudinary: CloudinaryProvider,
  ) {}

  /**
   * Upload d'une image/vidéo — Cloudinary si configuré, sinon le disque
   * local comme avant (voir CloudinaryProvider, jamais un cutover forcé).
   * Jamais utilisé pour un vocal, qui reste toujours sur StorageService.
   */
  private async saveMediaFile(
    buffer: Buffer,
    extension: string,
    resourceType: 'image' | 'video',
  ): Promise<{ key: string; sizeBytes: number; storageProvider: MediaStorageProvider }> {
    if (this.cloudinary.isConfigured()) {
      const uploaded = await this.cloudinary.upload(buffer, 'attachment', resourceType);
      return {
        key: uploaded.publicId,
        sizeBytes: buffer.byteLength,
        storageProvider: 'CLOUDINARY',
      };
    }
    const stored = await this.storage.save(buffer, 'attachment', extension);
    return { key: stored.key, sizeBytes: stored.sizeBytes, storageProvider: 'LOCAL' };
  }

  private async deleteMediaFile(attachment: {
    url: string;
    storageProvider: MediaStorageProvider;
    type: 'IMAGE' | 'VIDEO';
  }): Promise<void> {
    if (attachment.storageProvider === 'CLOUDINARY') {
      await this.cloudinary.delete(
        attachment.url,
        attachment.type === 'VIDEO' ? 'video' : 'image',
        'authenticated',
      );
    } else {
      await this.storage.delete(attachment.url);
    }
  }

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

    // Mentions (@nom/@everyone, section 12) — jamais pour une conversation
    // DIRECT (voir processMentions). Recharge le message avant diffusion
    // s'il a été modifié (mentionsEveryone/mentions créées), même principe
    // que pour une réaction.
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
      select: { type: true },
    });
    const mentioned = await this.processMentions(
      dto.conversationId,
      conversation?.type ?? 'DIRECT',
      message.id,
      dto.text,
      userId,
    );
    const finalMessage = mentioned
      ? await this.prisma.message.findUniqueOrThrow({
          where: { id: message.id },
          include: MESSAGE_INCLUDE,
        })
      : message;

    this.events.emitToUsers(recipients, 'message:new', toMessageDto(finalMessage, this.cloudinary));

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

    return toMessageDto(finalMessage, this.cloudinary);
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

    // Enregistré sur disque/Cloudinary avant l'écriture en base (même ordre
    // que VoiceService/StatusesService) : en cas d'échec de la transaction,
    // un fichier orphelin est un moindre mal qu'une ligne en base pointant
    // vers un fichier qui n'a jamais été écrit.
    const stored = await this.saveMediaFile(file.buffer, extension, 'image');

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
              // PHASES.md) : contient en réalité une clé de stockage locale
              // ou un public_id Cloudinary selon storageProvider, jamais
              // exposée telle quelle (voir toMessageDto).
              url: stored.key,
              storageProvider: stored.storageProvider,
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

    const imgConversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
      select: { type: true },
    });
    const imgMentioned = await this.processMentions(
      dto.conversationId,
      imgConversation?.type ?? 'DIRECT',
      message.id,
      dto.text,
      userId,
    );
    const imgFinalMessage = imgMentioned
      ? await this.prisma.message.findUniqueOrThrow({
          where: { id: message.id },
          include: MESSAGE_INCLUDE,
        })
      : message;

    this.events.emitToUsers(
      recipients,
      'message:new',
      toMessageDto(imgFinalMessage, this.cloudinary),
    );

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

    return toMessageDto(imgFinalMessage, this.cloudinary);
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

    // Enregistrés sur disque/Cloudinary avant l'écriture en base (même
    // ordre que pour un message IMAGE seul) : en cas d'échec de la
    // transaction, des fichiers orphelins sont un moindre mal qu'une ligne
    // en base pointant vers un fichier jamais écrit.
    const stored = await Promise.all(
      files.map(async (file, index) => {
        const isVideo = Boolean(ALLOWED_VIDEO_MIME_TYPES[file.mimetype]);
        const extension = isVideo
          ? ALLOWED_VIDEO_MIME_TYPES[file.mimetype]
          : ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
        const savedFile = await this.saveMediaFile(
          file.buffer,
          extension,
          isVideo ? 'video' : 'image',
        );
        const meta = metaByIndex[index] ?? {};
        return {
          ownerId: userId,
          url: savedFile.key,
          storageProvider: savedFile.storageProvider,
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

    const mediaConversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
      select: { type: true },
    });
    const mediaMentioned = await this.processMentions(
      dto.conversationId,
      mediaConversation?.type ?? 'DIRECT',
      message.id,
      dto.text,
      userId,
    );
    const mediaFinalMessage = mediaMentioned
      ? await this.prisma.message.findUniqueOrThrow({
          where: { id: message.id },
          include: MESSAGE_INCLUDE,
        })
      : message;

    this.events.emitToUsers(
      recipients,
      'message:new',
      toMessageDto(mediaFinalMessage, this.cloudinary),
    );

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

    return toMessageDto(mediaFinalMessage, this.cloudinary);
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

    if (attachment.storageProvider !== 'LOCAL') {
      // Ne devrait jamais être atteint en usage normal : toAttachmentDto
      // renvoie directement l'URL Cloudinary signée, jamais ce chemin proxy,
      // pour une pièce jointe CLOUDINARY. Un lien resté en cache après
      // migration d'une pièce jointe, par exemple, tombe ici plutôt que de
      // tenter de lire un public_id Cloudinary comme une clé de fichier local.
      throw new NotFoundException('Cette pièce jointe ne se sert plus par cette route.');
    }

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
      items: page.reverse().map((m) => toMessageDto(m, this.cloudinary)),
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
      items: page.map((a) => toAttachmentDto(a, this.cloudinary)),
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
      items: page.map((m) => toMessageDto(m, this.cloudinary)),
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
      items: [...olderPage.reverse(), ...newer].map((m) => toMessageDto(m, this.cloudinary)),
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
    this.events.emitToUsers(recipients, 'message:updated', toMessageDto(updated, this.cloudinary));

    return toMessageDto(updated, this.cloudinary);
  }

  async remove(userId: string, messageId: string): Promise<MessageDto> {
    const message = await this.requireOwnedMessage(userId, messageId, 'supprimer');

    if (message.deletedAt) {
      return toMessageDto({ ...message, reads: [] }, this.cloudinary); // déjà supprimé : idempotent
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), text: null },
      include: MESSAGE_INCLUDE,
    });

    // Fichier(s) effacés après la mise à jour en base (même ordre que
    // VoiceService.remove) : jamais de fichier référencé par une ligne qui
    // n'existe plus côté suppression, best-effort si le stockage échoue.
    if ((updated.attachments ?? []).length > 0) {
      const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
      await Promise.all(attachments.map((a) => this.deleteMediaFile(a)));
    }

    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(recipients, 'message:deleted', {
      id: updated.id,
      conversationId: updated.conversationId,
    });

    return toMessageDto(updated, this.cloudinary);
  }

  /**
   * Suppression déclenchée depuis la modération admin (voir AdminService) —
   * jamais d'appartenance à la conversation à vérifier ici : contrairement à
   * `remove()` (propriétaire uniquement), un admin n'est pas forcément
   * membre de la conversation modérée. Mêmes effets de bord que `remove()`
   * (fichiers effacés, `message:deleted` diffusé à tous les membres) —
   * une nouvelle méthode plutôt qu'un paramètre optionnel sur `remove()`,
   * pour ne jamais affaiblir silencieusement la vérification normale.
   */
  async removeAsAdmin(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('Message introuvable.');
    }
    if (message.deletedAt) return; // déjà supprimé : idempotent

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), text: null },
      include: MESSAGE_INCLUDE,
    });

    if ((updated.attachments ?? []).length > 0) {
      const attachments = await this.prisma.attachment.findMany({ where: { messageId } });
      await Promise.all(attachments.map((a) => this.deleteMediaFile(a)));
    }

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: message.conversationId, leftAt: null },
      select: { userId: true },
    });
    this.events.emitToUsers(
      members.map((m) => m.userId),
      'message:deleted',
      { id: updated.id, conversationId: updated.conversationId },
    );
  }

  /**
   * Ajoute la réaction de l'utilisateur à ce message, ou la remplace s'il en
   * avait déjà une (section 9 : "ajouter/modifier sa réaction" — une seule
   * réaction par utilisateur par message, voir la contrainte unique
   * `[messageId, userId]` sur Reaction). Jamais de notification vers
   * soi-même en réagissant à son propre message.
   */
  async addOrChangeReaction(userId: string, messageId: string, emoji: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message introuvable.');
    }
    await this.assertMembership(userId, message.conversationId);

    await this.prisma.reaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { emoji },
      create: { messageId, userId, emoji },
    });

    const updated = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });

    // L'auteur de la réaction est inclus (pas seulement les autres membres) :
    // ses AUTRES appareils connectés doivent aussi voir sa propre réaction
    // apparaître — même principe que markConversationRead ci-dessus. Sans
    // ça, le client qui vient de réagir ne recevrait jamais sa propre mise à
    // jour (il n'y a pas de patch optimiste local côté frontend, seul ce
    // canal socket met à jour l'affichage).
    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(
      [...recipients, userId],
      'message:updated',
      toMessageDto(updated, this.cloudinary),
    );

    if (message.senderId !== userId) {
      await this.notifications.create(message.senderId, 'REACTION', {
        conversationId: message.conversationId,
        messageId,
        emoji,
        userId,
      });
    }

    return toMessageDto(updated, this.cloudinary);
  }

  /** Supprime la réaction de l'utilisateur à ce message — idempotent, aucune erreur s'il n'en avait pas. */
  async removeReaction(userId: string, messageId: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message introuvable.');
    }
    await this.assertMembership(userId, message.conversationId);

    await this.prisma.reaction.deleteMany({ where: { messageId, userId } });

    const updated = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });

    // Voir addOrChangeReaction ci-dessus : l'auteur est inclus pour que ses
    // autres appareils voient aussi la suppression de sa propre réaction.
    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(
      [...recipients, userId],
      'message:updated',
      toMessageDto(updated, this.cloudinary),
    );

    return toMessageDto(updated, this.cloudinary);
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

  /** @nom (n'importe où dans le texte) et @everyone (section 12) — jamais interprétés à l'intérieur d'un autre mot (précédés d'un début de chaîne ou d'un espace). */
  private extractMentionTokens(text: string): { usernames: string[]; everyone: boolean } {
    const usernames = new Set<string>();
    let everyone = false;
    const regex = /(?:^|\s)@([a-zA-Z0-9_.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      if (match[1].toLowerCase() === 'everyone') everyone = true;
      else usernames.add(match[1]);
    }
    return { usernames: [...usernames], everyone };
  }

  /**
   * Crée les mentions individuelles/@everyone détectées dans `text` et
   * notifie — jamais pour une conversation DIRECT (mentionner n'a de sens
   * qu'à plusieurs, section 12). @everyone nécessite
   * `mentionEveryonePermission` (ADMIN_ONLY par défaut, jamais un simple
   * membre par défaut — une mention de masse a un potentiel de nuisance
   * différent d'un message normal). Renvoie `true` si le message a été
   * modifié (donc à recharger avant de le diffuser/renvoyer).
   */
  private async processMentions(
    conversationId: string,
    conversationType: string,
    messageId: string,
    text: string | null | undefined,
    actorId: string,
  ): Promise<boolean> {
    if (conversationType !== 'GROUP' || !text) return false;
    const { usernames, everyone } = this.extractMentionTokens(text);
    if (usernames.length === 0 && !everyone) return false;

    let mentionsEveryone = false;
    if (everyone) {
      const [conversation, actorMembership] = await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { mentionEveryonePermission: true },
        }),
        this.prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId: actorId } },
          select: { role: true },
        }),
      ]);
      mentionsEveryone = Boolean(
        conversation &&
        actorMembership &&
        !(
          conversation.mentionEveryonePermission === 'ADMIN_ONLY' &&
          actorMembership.role !== 'ADMIN'
        ),
      );
    }

    const mentionedMembers =
      usernames.length > 0
        ? await this.prisma.conversationMember.findMany({
            where: { conversationId, leftAt: null, user: { username: { in: usernames } } },
            select: { userId: true },
          })
        : [];
    const mentionedUserIds = [...new Set(mentionedMembers.map((m) => m.userId))].filter(
      (id) => id !== actorId,
    );

    if (!mentionsEveryone && mentionedUserIds.length === 0) return false;

    await this.prisma.$transaction([
      ...(mentionedUserIds.length > 0
        ? [
            this.prisma.messageMention.createMany({
              data: mentionedUserIds.map((userId) => ({ messageId, userId })),
              skipDuplicates: true,
            }),
          ]
        : []),
      ...(mentionsEveryone
        ? [
            this.prisma.message.update({
              where: { id: messageId },
              data: { mentionsEveryone: true },
            }),
          ]
        : []),
    ]);

    const notifyIds = mentionsEveryone
      ? await this.otherMemberIds(conversationId, actorId)
      : mentionedUserIds;
    await Promise.all(
      notifyIds.map((userId) =>
        this.notifications.create(userId, 'MENTION', { conversationId, messageId, actorId }),
      ),
    );

    return true;
  }
}
