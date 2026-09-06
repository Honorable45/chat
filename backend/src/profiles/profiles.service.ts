import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Profile, Prisma } from '@prisma/client';
import type { ReadStream } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_EXTENSION_TO_MIME_TYPE,
  MAX_IMAGE_SIZE_BYTES,
} from '../uploads/media-upload.constants';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { matchesFileSignature } from '../uploads/file-signature.util';
import { StorageService } from '../uploads/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface AvatarStream {
  stream: ReadStream;
  mimeType: string;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cloudinary: CloudinaryProvider,
  ) {}

  private async deleteAvatarFile(key: string, provider: 'LOCAL' | 'CLOUDINARY'): Promise<void> {
    if (provider === 'CLOUDINARY') {
      await this.cloudinary.delete(key, 'image', 'upload');
    } else {
      await this.storage.delete(key);
    }
  }

  findByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } });
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    const data: Prisma.ProfileUpdateInput = {
      ...dto,
      // On horodate le consentement à chaque changement explicite (activation
      // ou désactivation) — utile pour l'audit et pour pouvoir couper toute
      // synthèse vocale antérieure à une révocation (section 15).
      ...(dto.voiceCloningConsent !== undefined ? { voiceCloningUpdatedAt: new Date() } : {}),
    };

    // Une URL externe fournie explicitement remplace un avatar téléversé —
    // les deux ne coexistent jamais (voir resolveAvatarUrl : le fichier
    // téléversé serait de toute façon prioritaire et masquerait cette URL
    // sans ce nettoyage, ce qui surprendrait l'utilisateur).
    if (dto.avatarUrl !== undefined) {
      const previous = await this.prisma.profile.findUnique({ where: { userId } });
      if (previous?.avatarStorageKey) {
        await this.deleteAvatarFile(previous.avatarStorageKey, previous.avatarStorageProvider);
        data.avatarStorageKey = null;
        data.avatarStorageProvider = 'LOCAL';
      }
    }

    return this.prisma.profile.update({ where: { userId }, data });
  }

  /** Remplace l'avatar par un fichier téléversé — écrase toute URL externe déjà saisie. */
  async setAvatar(userId: string, file: Express.Multer.File | undefined): Promise<Profile> {
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

    const previous = await this.prisma.profile.findUnique({ where: { userId } });

    // Cloudinary si configuré (upload public, jamais signé — un avatar l'est
    // déjà par nature, voir CloudinaryProvider.uploadPublic), sinon le
    // disque local comme avant.
    const { key, provider } = this.cloudinary.isConfigured()
      ? await this.cloudinary
          .uploadPublic(file.buffer, 'avatar')
          .then((uploaded) => ({ key: uploaded.publicId, provider: 'CLOUDINARY' as const }))
      : await this.storage
          .save(file.buffer, 'avatar', extension)
          .then((stored) => ({ key: stored.key, provider: 'LOCAL' as const }));

    if (previous?.avatarStorageKey) {
      await this.deleteAvatarFile(previous.avatarStorageKey, previous.avatarStorageProvider);
    }

    return this.prisma.profile.update({
      where: { userId },
      data: { avatarStorageKey: key, avatarStorageProvider: provider, avatarUrl: null },
    });
  }

  async removeAvatar(userId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.avatarStorageKey) return; // rien à faire : idempotent
    await this.deleteAvatarFile(profile.avatarStorageKey, profile.avatarStorageProvider);
    await this.prisma.profile.update({
      where: { userId },
      data: { avatarStorageKey: null, avatarStorageProvider: 'LOCAL' },
    });
  }

  /** Public (voir UserAvatarController, non protégé par JwtAuthGuard) : un avatar n'est pas une donnée sensible. */
  async streamAvatar(userId: string): Promise<AvatarStream> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.avatarStorageKey) {
      throw new NotFoundException('Avatar introuvable.');
    }
    if (profile.avatarStorageProvider !== 'LOCAL') {
      // Ne devrait jamais être atteint en usage normal — resolveAvatarUrl
      // renvoie directement l'URL Cloudinary publique, jamais ce chemin
      // proxy, pour un avatar CLOUDINARY (voir avatar.util.ts).
      throw new NotFoundException('Cet avatar ne se sert plus par cette route.');
    }
    if (!(await this.storage.exists(profile.avatarStorageKey))) {
      throw new NotFoundException('Fichier introuvable.');
    }
    const extension = profile.avatarStorageKey.split('.').pop() ?? '';
    return {
      stream: this.storage.createReadStream(profile.avatarStorageKey),
      mimeType: IMAGE_EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream',
    };
  }
}
