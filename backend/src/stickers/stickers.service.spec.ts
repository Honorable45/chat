import { PrismaService } from '../prisma/prisma.service';
import { StickersService } from './stickers.service';

describe('StickersService', () => {
  let prisma: {
    favoriteSticker: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  };
  let service: StickersService;

  beforeEach(() => {
    prisma = {
      favoriteSticker: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    };
    service = new StickersService(prisma as unknown as PrismaService);
  });

  describe('listFavorites', () => {
    it("renvoie la liste des emojis favoris de l'utilisateur, du plus ancien au plus récent", async () => {
      prisma.favoriteSticker.findMany.mockResolvedValue([{ emoji: '😂' }, { emoji: '❤️' }]);

      const result = await service.listFavorites('user-1');

      expect(result).toEqual(['😂', '❤️']);
      expect(prisma.favoriteSticker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('addFavorite', () => {
    it('upsert (idempotent) sur la contrainte userId+emoji', async () => {
      await service.addFavorite('user-1', '😂');

      expect(prisma.favoriteSticker.upsert).toHaveBeenCalledWith({
        where: { userId_emoji: { userId: 'user-1', emoji: '😂' } },
        create: { userId: 'user-1', emoji: '😂' },
        update: {},
      });
    });
  });

  describe('removeFavorite', () => {
    it("supprime sans jamais lever d'erreur pour un favori déjà absent (deleteMany, pas delete)", async () => {
      prisma.favoriteSticker.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeFavorite('user-1', '😂')).resolves.toBeUndefined();
      expect(prisma.favoriteSticker.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', emoji: '😂' },
      });
    });
  });
});
