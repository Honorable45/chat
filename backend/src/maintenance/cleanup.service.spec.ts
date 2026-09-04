import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/storage.service';
import { CleanupService } from './cleanup.service';

describe('CleanupService', () => {
  let prisma: {
    userSession: { deleteMany: jest.Mock };
    passwordResetToken: { deleteMany: jest.Mock };
    status: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let storage: { delete: jest.Mock };
  let service: CleanupService;

  beforeEach(() => {
    prisma = {
      userSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      status: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    service = new CleanupService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  describe('cleanupExpiredSessions', () => {
    it('supprime uniquement les sessions dont expiresAt est passé', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanupExpiredSessions();

      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('ne plante jamais si la base est indisponible', async () => {
      prisma.userSession.deleteMany.mockRejectedValue(new Error('DatabaseNotReachable'));

      await expect(service.cleanupExpiredSessions()).resolves.toBeUndefined();
    });
  });

  describe('cleanupExpiredPasswordResetTokens', () => {
    it('ne plante jamais si la base est indisponible', async () => {
      prisma.passwordResetToken.deleteMany.mockRejectedValue(new Error('panne'));

      await expect(service.cleanupExpiredPasswordResetTokens()).resolves.toBeUndefined();
    });
  });

  describe('cleanupExpiredStatuses', () => {
    it("ne fait rien s'il n'y a aucun statut expiré", async () => {
      prisma.status.findMany.mockResolvedValue([]);

      await service.cleanupExpiredStatuses();

      expect(prisma.status.deleteMany).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('supprime les lignes puis les fichiers associés, en ignorant les statuts texte sans média', async () => {
      prisma.status.findMany.mockResolvedValue([
        { id: 'status-1', mediaStorageKey: 'status/a.jpg' },
        { id: 'status-2', mediaStorageKey: null }, // statut texte
      ]);

      await service.cleanupExpiredStatuses();

      expect(prisma.status.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['status-1', 'status-2'] } },
      });
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith('status/a.jpg');
    });

    it('ne plante jamais si la suppression du fichier échoue', async () => {
      prisma.status.findMany.mockResolvedValue([
        { id: 'status-1', mediaStorageKey: 'status/a.jpg' },
      ]);
      storage.delete.mockRejectedValue(new Error('disque plein'));

      await expect(service.cleanupExpiredStatuses()).resolves.toBeUndefined();
    });
  });
});
