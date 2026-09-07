import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { MediaStorageProvider, Prisma, Status, StatusType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';
import { ALLOWED_AUDIO_MIME_TYPES, MAX_AUDIO_SIZE_BYTES } from '../uploads/audio-upload.constants';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from '../uploads/media-upload.constants';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { matchesFileSignature } from '../uploads/file-signature.util';
import { StorageService } from '../uploads/storage.service';
import { ContactsService } from '../contacts/contacts.service';
import { CreateStatusDto } from './dto/create-status.dto';

const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // section 21 : expire après 24h

function invert(map: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([mime, ext]) => [ext, mime]));
}

const MEDIA_RULES: Record<
  Exclude<StatusType, 'TEXT'>,
  {
    mimeTypes: Readonly<Record<string, string>>;
    maxSizeBytes: number;
    // Par type plutôt qu'une seule table fusionnée : "webm" est une
    // extension partagée par audio/webm ET video/webm (voir
    // audio-upload.constants.ts / media-upload.constants.ts) — une table
    // fusionnée ferait gagner arbitrairement l'un des deux quel que soit le
    // type réel du statut (bug constaté en pratique : une vidéo .webm était
    // servie en Content-Type "audio/webm"). Le type du statut, déjà connu en
    // base, lève l'ambiguïté sans avoir à la deviner depuis l'extension seule.
    extensionToMimeType: Readonly<Record<string, string>>;
  }
> = {
  IMAGE: {
    mimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    extensionToMimeType: invert(ALLOWED_IMAGE_MIME_TYPES),
  },
  VIDEO: {
    mimeTypes: ALLOWED_VIDEO_MIME_TYPES,
    maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
    extensionToMimeType: invert(ALLOWED_VIDEO_MIME_TYPES),
  },
  VOICE: {
    mimeTypes: ALLOWED_AUDIO_MIME_TYPES,
    maxSizeBytes: MAX_AUDIO_SIZE_BYTES,
    extensionToMimeType: invert(ALLOWED_AUDIO_MIME_TYPES),
  },
};

const STATUS_WITH_AUTHOR_INCLUDE = {
  user: { include: { profile: true } },
  _count: { select: { views: true } },
} satisfies Prisma.StatusInclude;

type StatusWithAuthor = Prisma.StatusGetPayload<{ include: typeof STATUS_WITH_AUTHOR_INCLUDE }>;

function toStatusDto(
  status: StatusWithAuthor,
  viewerId: string,
  viewedByMe: boolean,
  cloudinary: CloudinaryProvider,
) {
  const isMine = status.userId === viewerId;
  const mediaUrl = !status.mediaStorageKey
    ? null
    : status.mediaStorageProvider === 'CLOUDINARY'
      ? cloudinary.getSignedUrl(status.mediaStorageKey, status.type === 'VIDEO' ? 'video' : 'image')
      : `/api/statuses/${status.id}/media`;
  return {
    id: status.id,
    type: status.type,
    text: status.text,
    mediaUrl,
    visibility: status.visibility,
    author: {
      id: status.user.id,
      username: status.user.username,
      firstName: status.user.firstName,
      lastName: status.user.lastName,
      avatarUrl: resolveAvatarUrl(status.user.profile, status.user.id),
    },
    isMine,
    viewedByMe,
    // Le nombre de vues (et a fortiori la liste des personnes) reste privé
    // à l'auteur (section 21) — jamais exposé aux autres viewers ici.
    viewCount: isMine ? status._count.views : null,
    createdAt: status.createdAt,
    expiresAt: status.expiresAt,
  };
}

export type StatusDto = ReturnType<typeof toStatusDto>;

export interface StatusMediaStream {
  stream: ReadStream;
  mimeType: string;
  sizeBytes: number | null;
}

@Injectable()
export class StatusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contacts: ContactsService,
    private readonly cloudinary: CloudinaryProvider,
  ) {}

  async create(
    userId: string,
    dto: CreateStatusDto,
    file: Express.Multer.File | undefined,
  ): Promise<StatusDto> {
    let mediaKey: string | null = null;
    let mediaProvider: MediaStorageProvider = 'LOCAL';

    if (dto.type === 'TEXT') {
      if (!dto.text?.trim()) {
        throw new BadRequestException('Un statut texte doit contenir du texte.');
      }
    } else {
      const extension = this.validateMediaFile(dto.type, file);
      // VOICE reste toujours sur StorageService, jamais Cloudinary — seul le
      // périmètre convenu (images/vidéos) peut y basculer.
      if (dto.type !== 'VOICE' && this.cloudinary.isConfigured()) {
        const uploaded = await this.cloudinary.upload(
          file!.buffer,
          'status',
          dto.type === 'VIDEO' ? 'video' : 'image',
        );
        mediaKey = uploaded.publicId;
        mediaProvider = 'CLOUDINARY';
      } else {
        const stored = await this.storage.save(file!.buffer, 'status', extension);
        mediaKey = stored.key;
      }
    }

    const status = await this.prisma.status.create({
      data: {
        userId,
        type: dto.type,
        text: dto.text,
        mediaStorageKey: mediaKey,
        mediaStorageProvider: mediaProvider,
        visibility: dto.visibility ?? 'CONTACTS',
        expiresAt: new Date(Date.now() + STATUS_TTL_MS),
      },
      include: STATUS_WITH_AUTHOR_INCLUDE,
    });

    return toStatusDto(status, userId, false, this.cloudinary);
  }

  /** Tous les statuts actifs (non expirés) que l'appelant est autorisé à voir. */
  async listVisible(viewerId: string): Promise<StatusDto[]> {
    const now = new Date();
    // "CONTACTS" : vrai carnet de contacts (ContactsService — section 2 de
    // la spécification NEXORA), plus une simple proximité de conversation
    // comme avant sa construction.
    const contactIds = await this.getContactIds(viewerId);

    const statuses = await this.prisma.status.findMany({
      where: {
        expiresAt: { gt: now },
        OR: [
          { userId: viewerId },
          { visibility: 'EVERYONE' },
          { visibility: 'CONTACTS', userId: { in: [...contactIds] } },
        ],
      },
      include: STATUS_WITH_AUTHOR_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    const viewedIds = await this.prisma.statusView.findMany({
      where: { viewerId, statusId: { in: statuses.map((s) => s.id) } },
      select: { statusId: true },
    });
    const viewedSet = new Set(viewedIds.map((v) => v.statusId));

    return statuses.map((status) =>
      toStatusDto(status, viewerId, viewedSet.has(status.id), this.cloudinary),
    );
  }

  async streamMedia(viewerId: string, statusId: string): Promise<StatusMediaStream> {
    const status = await this.loadVisible(viewerId, statusId);
    if (!status.mediaStorageKey || status.type === 'TEXT') {
      throw new NotFoundException('Ce statut ne contient pas de média.');
    }
    if (status.mediaStorageProvider !== 'LOCAL') {
      // Ne devrait jamais être atteint en usage normal — voir le
      // commentaire équivalent dans MessagesService.streamAttachment.
      throw new NotFoundException('Ce média ne se sert plus par cette route.');
    }
    if (!(await this.storage.exists(status.mediaStorageKey))) {
      throw new NotFoundException('Fichier introuvable.');
    }

    const extension = status.mediaStorageKey.split('.').pop() ?? '';
    return {
      stream: this.storage.createReadStream(status.mediaStorageKey),
      mimeType:
        MEDIA_RULES[status.type].extensionToMimeType[extension] ?? 'application/octet-stream',
      sizeBytes: null,
    };
  }

  /** Marque comme vu — ignoré pour ses propres statuts (section 21 : ne compte pas ses propres vues). */
  async markViewed(viewerId: string, statusId: string): Promise<void> {
    const status = await this.loadVisible(viewerId, statusId);
    if (status.userId === viewerId) return;

    await this.prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId } },
      create: { statusId, viewerId },
      update: {}, // idempotent : garde l'horodatage de la première vue
    });
  }

  /** Qui a vu ce statut — réservé à son auteur (section 21). */
  async getViews(userId: string, statusId: string) {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status || status.expiresAt < new Date()) {
      throw new NotFoundException('Statut introuvable.');
    }
    if (status.userId !== userId) {
      throw new ForbiddenException("Seul l'auteur peut voir qui a consulté ce statut.");
    }

    const views = await this.prisma.statusView.findMany({
      where: { statusId },
      include: { viewer: { include: { profile: true } } },
      orderBy: { viewedAt: 'desc' },
    });

    return views.map((view) => ({
      viewedAt: view.viewedAt,
      viewer: {
        id: view.viewer.id,
        username: view.viewer.username,
        firstName: view.viewer.firstName,
        lastName: view.viewer.lastName,
        avatarUrl: resolveAvatarUrl(view.viewer.profile, view.viewer.id),
      },
    }));
  }

  async remove(userId: string, statusId: string): Promise<void> {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status) throw new NotFoundException('Statut introuvable.');
    if (status.userId !== userId) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres statuts.');
    }

    // Supprime la ligne (StatusView cascade au niveau base) avant le fichier :
    // en cas d'échec du storage, on ne garde jamais une référence orpheline
    // en base pointant vers un fichier qu'on n'a pas réussi à effacer.
    await this.prisma.status.delete({ where: { id: statusId } });
    if (status.mediaStorageKey) {
      await this.deleteMedia(status.mediaStorageKey, status.mediaStorageProvider, status.type);
    }
  }

  /**
   * Suppression déclenchée depuis la modération admin (voir AdminService) —
   * jamais de vérification de propriétaire ici, contrairement à `remove()`.
   * Nouvelle méthode plutôt qu'un paramètre optionnel sur `remove()`, pour
   * ne jamais affaiblir silencieusement la vérification normale (même choix
   * que MessagesService.removeAsAdmin).
   */
  async removeAsAdmin(statusId: string): Promise<void> {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status) throw new NotFoundException('Statut introuvable.');

    await this.prisma.status.delete({ where: { id: statusId } });
    if (status.mediaStorageKey) {
      await this.deleteMedia(status.mediaStorageKey, status.mediaStorageProvider, status.type);
    }
  }

  private async deleteMedia(
    key: string,
    provider: MediaStorageProvider,
    type: StatusType,
  ): Promise<void> {
    if (provider === 'CLOUDINARY') {
      await this.cloudinary.delete(key, type === 'VIDEO' ? 'video' : 'image', 'authenticated');
    } else {
      await this.storage.delete(key);
    }
  }

  /** Charge un statut et vérifie qu'il est actif ET visible par ce viewer — 404 sinon (section 23). */
  private async loadVisible(viewerId: string, statusId: string): Promise<Status> {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status || status.expiresAt < new Date()) {
      throw new NotFoundException('Statut introuvable.');
    }
    if (status.userId === viewerId) return status;

    if (status.visibility === 'NOBODY') {
      throw new NotFoundException('Statut introuvable.');
    }
    if (status.visibility === 'CONTACTS') {
      const contactIds = await this.getContactIds(viewerId);
      if (!contactIds.has(status.userId)) {
        throw new NotFoundException('Statut introuvable.');
      }
    }
    return status;
  }

  private validateMediaFile(
    type: Exclude<StatusType, 'TEXT'>,
    file: Express.Multer.File | undefined,
  ): string {
    if (!file || file.size === 0) {
      throw new BadRequestException(`Un fichier est requis pour un statut de type ${type}.`);
    }

    const rules = MEDIA_RULES[type];
    const extension = rules.mimeTypes[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Format non supporté pour un statut ${type} : "${file.mimetype}". Formats acceptés : ${Object.keys(rules.mimeTypes).join(', ')}.`,
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
    if (file.size > rules.maxSizeBytes) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
          rules.maxSizeBytes / (1024 * 1024)
        } Mo).`,
      );
    }
    return extension;
  }

  /** Voir la note dans listVisible() : "contact" = partage déjà une conversation active. */
  private getContactIds(userId: string): Promise<Set<string>> {
    return this.contacts.listContactIds(userId);
  }
}
