import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Profile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { StorageService } from '../uploads/storage.service';
import { ProfilesService } from './profiles.service';

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    avatarUrl: null,
    avatarStorageKey: null,
    avatarStorageProvider: 'LOCAL',
    statusText: null,
    voiceCloningConsent: false,
    voiceCloningUpdatedAt: null,
    voiceModelId: null,
    showLastSeen: true,
    showOnlineStatus: true,
    showReadReceipts: true,
    whoCanMessageMe: 'EVERYONE',
    whoCanSeeMyStatus: 'EVERYONE',
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Signature JPEG réelle minimale — depuis l'audit de sécurité,
// ProfilesService vérifie les octets du fichier en plus du Content-Type
// déclaré (voir file-signature.util.ts), un buffer de remplissage seul ne
// suffit donc plus à passer la validation.
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function buildFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'avatar',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 1000,
    buffer: Buffer.concat([JPEG_SIGNATURE, Buffer.alloc(1000 - JPEG_SIGNATURE.length, 1)]),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

describe('ProfilesService', () => {
  let prisma: { profile: { findUnique: jest.Mock; update: jest.Mock } };
  let storage: {
    save: jest.Mock;
    exists: jest.Mock;
    createReadStream: jest.Mock;
    delete: jest.Mock;
  };
  let cloudinary: {
    isConfigured: jest.Mock;
    uploadPublic: jest.Mock;
    delete: jest.Mock;
  };
  let service: ProfilesService;

  beforeEach(() => {
    prisma = { profile: { findUnique: jest.fn(), update: jest.fn() } };
    storage = {
      save: jest.fn().mockResolvedValue({ key: 'avatar/new.jpg', sizeBytes: 1000 }),
      exists: jest.fn().mockResolvedValue(true),
      createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    // Non configuré par défaut : chaque test existant continue de passer
    // par StorageService (LOCAL) — voir describe('Cloudinary', ...) plus bas.
    cloudinary = {
      isConfigured: jest.fn().mockReturnValue(false),
      uploadPublic: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProfilesService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      cloudinary as unknown as CloudinaryProvider,
    );
  });

  describe('update', () => {
    it("efface l'avatar téléversé quand une URL externe est explicitement fournie", async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ avatarStorageKey: 'avatar/old.jpg' }),
      );
      prisma.profile.update.mockResolvedValue(
        buildProfile({ avatarUrl: 'https://example.com/x.png' }),
      );

      await service.update('user-1', { avatarUrl: 'https://example.com/x.png' });

      expect(storage.delete).toHaveBeenCalledWith('avatar/old.jpg');
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        // Les matchers Jest imbriqués (`expect.objectContaining` dans un
        // objet littéral) sont typés `any` dans @types/jest — sans danger
        // ici, c'est un assert de test, pas du code applicatif.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          avatarUrl: 'https://example.com/x.png',
          avatarStorageKey: null,
        }),
      });
    });

    it("ne touche pas à l'avatar si le DTO ne contient pas avatarUrl", async () => {
      prisma.profile.update.mockResolvedValue(buildProfile());

      await service.update('user-1', { statusText: 'Salut' });

      expect(prisma.profile.findUnique).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('horodate le consentement quand voiceCloningConsent change', async () => {
      prisma.profile.update.mockResolvedValue(buildProfile());

      await service.update('user-1', { voiceCloningConsent: true });

      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- voir le commentaire ci-dessus
        data: expect.objectContaining({
          voiceCloningConsent: true,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          voiceCloningUpdatedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('setAvatar', () => {
    it('refuse sans fichier', async () => {
      await expect(service.setAvatar('user-1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse un type non supporté', async () => {
      await expect(
        service.setAvatar('user-1', buildFile({ mimetype: 'application/pdf' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un fichier trop volumineux', async () => {
      await expect(
        service.setAvatar('user-1', buildFile({ size: 20 * 1024 * 1024 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('stocke le fichier, efface avatarUrl et remplace un avatar existant', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ avatarStorageKey: 'avatar/old.jpg' }),
      );
      prisma.profile.update.mockResolvedValue(buildProfile({ avatarStorageKey: 'avatar/new.jpg' }));

      const result = await service.setAvatar('user-1', buildFile());

      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'avatar', 'jpg');
      expect(storage.delete).toHaveBeenCalledWith('avatar/old.jpg');
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: {
          avatarStorageKey: 'avatar/new.jpg',
          avatarStorageProvider: 'LOCAL',
          avatarUrl: null,
        },
      });
      expect(result.avatarStorageKey).toBe('avatar/new.jpg');
    });

    it("n'essaie pas de supprimer un ancien fichier s'il n'y en avait pas", async () => {
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ avatarStorageKey: null }));
      prisma.profile.update.mockResolvedValue(buildProfile({ avatarStorageKey: 'avatar/new.jpg' }));

      await service.setAvatar('user-1', buildFile());

      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('utilise Cloudinary (upload public, jamais signé) quand configuré', async () => {
      cloudinary.isConfigured.mockReturnValue(true);
      cloudinary.uploadPublic.mockResolvedValue({ publicId: 'glotta/avatar/new123' });
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ avatarStorageKey: null }));
      prisma.profile.update.mockResolvedValue(
        buildProfile({
          avatarStorageKey: 'glotta/avatar/new123',
          avatarStorageProvider: 'CLOUDINARY',
        }),
      );

      const result = await service.setAvatar('user-1', buildFile());

      expect(cloudinary.uploadPublic).toHaveBeenCalledWith(expect.any(Buffer), 'avatar');
      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: {
          avatarStorageKey: 'glotta/avatar/new123',
          avatarStorageProvider: 'CLOUDINARY',
          avatarUrl: null,
        },
      });
      expect(result.avatarStorageProvider).toBe('CLOUDINARY');
    });

    it('supprime un ancien avatar Cloudinary via cloudinary.delete, jamais storage.delete', async () => {
      cloudinary.isConfigured.mockReturnValue(true);
      cloudinary.uploadPublic.mockResolvedValue({ publicId: 'glotta/avatar/new123' });
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({
          avatarStorageKey: 'glotta/avatar/old123',
          avatarStorageProvider: 'CLOUDINARY',
        }),
      );
      prisma.profile.update.mockResolvedValue(buildProfile());

      await service.setAvatar('user-1', buildFile());

      expect(cloudinary.delete).toHaveBeenCalledWith('glotta/avatar/old123', 'image', 'upload');
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeAvatar', () => {
    it("ne fait rien si aucun avatar n'est téléversé (idempotent)", async () => {
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ avatarStorageKey: null }));

      await service.removeAvatar('user-1');

      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.profile.update).not.toHaveBeenCalled();
    });

    it('supprime le fichier puis efface la clé en base', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ avatarStorageKey: 'avatar/old.jpg' }),
      );

      await service.removeAvatar('user-1');

      expect(storage.delete).toHaveBeenCalledWith('avatar/old.jpg');
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { avatarStorageKey: null, avatarStorageProvider: 'LOCAL' },
      });
    });
  });

  describe('streamAvatar', () => {
    it("refuse si l'utilisateur n'a pas d'avatar téléversé", async () => {
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ avatarStorageKey: null }));

      await expect(service.streamAvatar('user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuse si le fichier n'existe plus sur le stockage", async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ avatarStorageKey: 'avatar/x.jpg' }),
      );
      storage.exists.mockResolvedValue(false);

      await expect(service.streamAvatar('user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("renvoie le flux avec le type MIME déduit de l'extension stockée", async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ avatarStorageKey: 'avatar/x.png' }),
      );

      const result = await service.streamAvatar('user-1');

      expect(result.mimeType).toBe('image/png');
      expect(storage.createReadStream).toHaveBeenCalledWith('avatar/x.png');
    });
  });
});
