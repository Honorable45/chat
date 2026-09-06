import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Profile, Status, User } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { StorageService } from '../uploads/storage.service';
import { StatusesService } from './statuses.service';

// Signature JPEG réelle minimale — depuis l'audit de sécurité,
// StatusesService vérifie les octets du fichier en plus du Content-Type
// déclaré (voir file-signature.util.ts), un buffer de remplissage seul ne
// suffit donc plus à passer la validation.
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function buildFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'media',
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

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'honore',
    email: 'honore@example.com',
    phone: null,
    passwordHash: 'hashed',
    firstName: 'Honoré',
    lastName: 'K.',
    primaryLanguageId: 'lang-fr',
    preferredReceiveLanguageId: 'lang-fr',
    isActive: true,
    role: 'USER',
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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

function buildStatus(overrides: Partial<Status> = {}) {
  return {
    id: 'status-1',
    userId: 'user-1',
    type: 'TEXT' as const,
    text: 'Salut',
    mediaStorageKey: null,
    mediaStorageProvider: 'LOCAL' as const,
    visibility: 'CONTACTS' as const,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    ...overrides,
  };
}

describe('StatusesService', () => {
  let prisma: {
    status: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
    statusView: { findMany: jest.Mock; upsert: jest.Mock };
    conversationMember: { findMany: jest.Mock };
  };
  let storage: {
    save: jest.Mock;
    exists: jest.Mock;
    createReadStream: jest.Mock;
    delete: jest.Mock;
  };
  let contacts: { listContactIds: jest.Mock };
  let cloudinary: {
    isConfigured: jest.Mock;
    isConfiguredForSignedMedia: jest.Mock;
    upload: jest.Mock;
    getSignedUrl: jest.Mock;
    delete: jest.Mock;
  };
  let service: StatusesService;

  beforeEach(() => {
    prisma = {
      status: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
      statusView: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      conversationMember: { findMany: jest.fn().mockResolvedValue([]) },
    };
    storage = {
      save: jest.fn().mockResolvedValue({ key: 'status/abc.jpg', sizeBytes: 1000 }),
      exists: jest.fn().mockResolvedValue(true),
      createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    contacts = { listContactIds: jest.fn().mockResolvedValue(new Set()) };
    // Non configuré par défaut : chaque test existant continue de passer
    // par StorageService (LOCAL) — voir describe('Cloudinary', ...) pour les
    // tests dédiés à la branche CLOUDINARY (jamais pour type VOICE).
    cloudinary = {
      isConfigured: jest.fn().mockReturnValue(false),
      isConfiguredForSignedMedia: jest.fn().mockReturnValue(false),
      upload: jest.fn(),
      getSignedUrl: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new StatusesService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      contacts as unknown as ContactsService,
      cloudinary as unknown as CloudinaryProvider,
    );
  });

  describe('create', () => {
    it('refuse un statut texte vide', async () => {
      await expect(
        service.create('user-1', { type: 'TEXT', text: '   ' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.status.create).not.toHaveBeenCalled();
    });

    it('refuse un statut média sans fichier', async () => {
      await expect(service.create('user-1', { type: 'IMAGE' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuse un type de fichier non supporté pour IMAGE', async () => {
      const file = buildFile({ mimetype: 'application/pdf' });
      await expect(service.create('user-1', { type: 'IMAGE' }, file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse une image trop volumineuse', async () => {
      const file = buildFile({ size: 20 * 1024 * 1024 });
      await expect(service.create('user-1', { type: 'IMAGE' }, file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('crée un statut image et calcule expiresAt à +24h', async () => {
      const created = {
        ...buildStatus({ type: 'IMAGE', text: null, mediaStorageKey: 'status/abc.jpg' }),
        user: { ...buildUser(), profile: buildProfile() },
        _count: { views: 0 },
      };
      prisma.status.create.mockResolvedValue(created);

      const before = Date.now();
      const result = await service.create('user-1', { type: 'IMAGE' }, buildFile());
      const after = Date.now();

      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'status', 'jpg');
      expect(result.mediaUrl).toBe('/api/statuses/status-1/media');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const call = prisma.status.create.mock.calls[0][0] as {
        data: { expiresAt: Date };
      };
      const expiresAtMs = call.data.expiresAt.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });
  });

  describe('Cloudinary (images/vidéos, jamais VOICE)', () => {
    it('utilise Cloudinary pour un statut IMAGE quand configuré', async () => {
      cloudinary.isConfiguredForSignedMedia.mockReturnValue(true);
      cloudinary.upload.mockResolvedValue({ publicId: 'glotta/status/abc123' });
      const created = {
        ...buildStatus({
          type: 'IMAGE',
          mediaStorageKey: 'glotta/status/abc123',
          mediaStorageProvider: 'CLOUDINARY',
        }),
        user: { ...buildUser(), profile: buildProfile() },
        _count: { views: 0 },
      };
      prisma.status.create.mockResolvedValue(created);
      cloudinary.getSignedUrl.mockReturnValue(
        'https://res.cloudinary.com/demo/image/authenticated/s--sig--/abc123',
      );

      const result = await service.create('user-1', { type: 'IMAGE' }, buildFile());

      expect(cloudinary.upload).toHaveBeenCalledWith(expect.any(Buffer), 'status', 'image');
      expect(storage.save).not.toHaveBeenCalled();
      expect(result.mediaUrl).toContain('cloudinary.com');
    });

    it("retombe sur StorageService pour IMAGE/VIDEO quand Cloudinary n'est pas configuré", async () => {
      cloudinary.isConfiguredForSignedMedia.mockReturnValue(false);
      const created = {
        ...buildStatus({ type: 'IMAGE', mediaStorageKey: 'status/abc.jpg' }),
        user: { ...buildUser(), profile: buildProfile() },
        _count: { views: 0 },
      };
      prisma.status.create.mockResolvedValue(created);

      await service.create('user-1', { type: 'IMAGE' }, buildFile());

      expect(storage.save).toHaveBeenCalled();
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it('un statut VOICE reste toujours sur StorageService, même quand Cloudinary est configuré', async () => {
      cloudinary.isConfiguredForSignedMedia.mockReturnValue(true);
      const voiceFile = buildFile({
        mimetype: 'audio/webm',
        originalname: 'voice.webm',
        // Signature EBML réelle (voir file-signature.util.ts) — le buffer
        // par défaut de buildFile() est un JPEG, refusé pour un type audio.
        buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      });
      const created = {
        ...buildStatus({ type: 'VOICE', mediaStorageKey: 'status/voice.webm' }),
        user: { ...buildUser(), profile: buildProfile() },
        _count: { views: 0 },
      };
      prisma.status.create.mockResolvedValue(created);

      await service.create('user-1', { type: 'VOICE' }, voiceFile);

      expect(storage.save).toHaveBeenCalled();
      expect(cloudinary.upload).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const call = prisma.status.create.mock.calls[0][0] as {
        data: { mediaStorageProvider: string };
      };
      expect(call.data.mediaStorageProvider).toBe('LOCAL');
    });
  });

  describe('listVisible', () => {
    it('inclut ses propres statuts et ceux visibles par tous, exclut les autres', async () => {
      prisma.status.findMany.mockResolvedValue([]);

      await service.listVisible('user-1');

      expect(prisma.status.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: expect.objectContaining({
            OR: [
              { userId: 'user-1' },
              { visibility: 'EVERYONE' },
              { visibility: 'CONTACTS', userId: { in: [] } },
            ],
          }),
        }),
      );
    });

    it('inclut les IDs des vrais contacts (ContactsService) dans le filtre CONTACTS', async () => {
      contacts.listContactIds.mockResolvedValue(new Set(['user-2']));
      prisma.status.findMany.mockResolvedValue([]);

      await service.listVisible('user-1');

      expect(prisma.status.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            OR: expect.arrayContaining([{ visibility: 'CONTACTS', userId: { in: ['user-2'] } }]),
          }),
        }),
      );
    });
  });

  describe('loadVisible (via markViewed)', () => {
    it("refuse un statut expiré (404, comme s'il n'existait pas)", async () => {
      prisma.status.findUnique.mockResolvedValue(
        buildStatus({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.markViewed('user-2', 'status-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse un statut visibility NOBODY pour quelqu'un d'autre que l'auteur", async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ visibility: 'NOBODY' }));

      await expect(service.markViewed('user-2', 'status-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse un statut CONTACTS pour quelqu'un qui n'est pas un contact accepté de l'auteur", async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ visibility: 'CONTACTS' }));
      contacts.listContactIds.mockResolvedValue(new Set()); // aucun contact

      await expect(service.markViewed('user-2', 'status-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('autorise un statut EVERYONE pour un inconnu', async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ visibility: 'EVERYONE' }));

      await service.markViewed('user-2', 'status-1');

      expect(prisma.statusView.upsert).toHaveBeenCalled();
    });

    it('ne compte pas ses propres vues', async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ userId: 'user-1' }));

      await service.markViewed('user-1', 'status-1');

      expect(prisma.statusView.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getViews', () => {
    it("refuse à quelqu'un d'autre que l'auteur", async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ userId: 'user-1' }));

      await expect(service.getViews('user-2', 'status-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('streamMedia', () => {
    it('refuse un statut TEXT (pas de média)', async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ userId: 'user-1', type: 'TEXT' }));

      await expect(service.streamMedia('user-1', 'status-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si le fichier n'existe plus sur le stockage", async () => {
      prisma.status.findUnique.mockResolvedValue(
        buildStatus({ userId: 'user-1', type: 'IMAGE', mediaStorageKey: 'status/abc.jpg' }),
      );
      storage.exists.mockResolvedValue(false);

      await expect(service.streamMedia('user-1', 'status-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('résout le bon type MIME pour une image', async () => {
      prisma.status.findUnique.mockResolvedValue(
        buildStatus({ userId: 'user-1', type: 'IMAGE', mediaStorageKey: 'status/abc.jpg' }),
      );

      const result = await service.streamMedia('user-1', 'status-1');

      expect(result.mimeType).toBe('image/jpeg');
    });

    it(
      'résout "video/webm" pour une vidéo au format webm, jamais "audio/webm" ' +
        '(régression : "webm" est une extension partagée par la vidéo et le vocal — ' +
        'un statut VIDEO ne doit jamais être servi avec un Content-Type audio)',
      async () => {
        prisma.status.findUnique.mockResolvedValue(
          buildStatus({ userId: 'user-1', type: 'VIDEO', mediaStorageKey: 'status/clip.webm' }),
        );

        const result = await service.streamMedia('user-1', 'status-1');

        expect(result.mimeType).toBe('video/webm');
      },
    );

    it('résout "audio/webm" pour un vocal au format webm (même extension, type différent)', async () => {
      prisma.status.findUnique.mockResolvedValue(
        buildStatus({ userId: 'user-1', type: 'VOICE', mediaStorageKey: 'status/voice.webm' }),
      );

      const result = await service.streamMedia('user-1', 'status-1');

      expect(result.mimeType).toBe('audio/webm');
    });
  });

  describe('remove', () => {
    it("refuse de supprimer le statut d'un autre utilisateur", async () => {
      prisma.status.findUnique.mockResolvedValue(buildStatus({ userId: 'user-1' }));

      await expect(service.remove('user-2', 'status-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.status.delete).not.toHaveBeenCalled();
    });

    it('supprime la ligne puis le fichier associé', async () => {
      prisma.status.findUnique.mockResolvedValue(
        buildStatus({ userId: 'user-1', mediaStorageKey: 'status/abc.jpg' }),
      );

      await service.remove('user-1', 'status-1');

      expect(prisma.status.delete).toHaveBeenCalledWith({ where: { id: 'status-1' } });
      expect(storage.delete).toHaveBeenCalledWith('status/abc.jpg');
    });
  });
});
