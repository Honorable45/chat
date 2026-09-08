import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Favoris de stickers (gros emojis, voir MessageType.STICKER côté
 * MessagesService) — purement une préférence personnelle par utilisateur,
 * jamais partagée : pilote seulement l'ordre/la mise en avant dans
 * StickerPicker.tsx, sans aucun effet sur les messages déjà envoyés.
 */
@Injectable()
export class StickersService {
  constructor(private readonly prisma: PrismaService) {}

  async listFavorites(userId: string): Promise<string[]> {
    const rows = await this.prisma.favoriteSticker.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { emoji: true },
    });
    return rows.map((r) => r.emoji);
  }

  /** Idempotent (upsert) : ajouter un favori déjà présent ne crée jamais de doublon (voir la contrainte unique userId+emoji). */
  async addFavorite(userId: string, emoji: string): Promise<void> {
    await this.prisma.favoriteSticker.upsert({
      where: { userId_emoji: { userId, emoji } },
      create: { userId, emoji },
      update: {},
    });
  }

  /** Idempotent : retirer un favori déjà absent ne lève jamais d'erreur (deleteMany, jamais delete). */
  async removeFavorite(userId: string, emoji: string): Promise<void> {
    await this.prisma.favoriteSticker.deleteMany({ where: { userId, emoji } });
  }
}
