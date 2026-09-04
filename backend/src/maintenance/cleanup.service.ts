import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/storage.service';

/**
 * Purge périodique des données expirées (section 15/23/33). Rien ici ne
 * change le comportement observable de l'API : les lectures filtrent déjà
 * par expiration (`expiresAt > now()` pour les statuts, vérification du
 * token pour les sessions) — ce service ne fait que libérer l'espace de
 * stockage et la base une fois que ces données ne peuvent plus être lues
 * de toute façon.
 *
 * Chaque tâche est isolée par son propre try/catch : l'échec d'une purge ne
 * doit jamais empêcher les autres de s'exécuter, ni faire planter le
 * scheduler (même leçon que PresenceService — voir PHASES.md phase 6).
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const result = await this.prisma.userSession.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        this.logger.log(`${result.count} session(s) expirée(s) supprimée(s).`);
      }
    } catch (error) {
      this.logger.warn(
        `Échec du nettoyage des sessions expirées : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredPasswordResetTokens(): Promise<void> {
    try {
      const result = await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        this.logger.log(`${result.count} jeton(s) de réinitialisation expiré(s) supprimé(s).`);
      }
    } catch (error) {
      this.logger.warn(
        `Échec du nettoyage des jetons de réinitialisation : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredStatuses(): Promise<void> {
    try {
      const expired = await this.prisma.status.findMany({
        where: { expiresAt: { lt: new Date() } },
        select: { id: true, mediaStorageKey: true },
      });
      if (expired.length === 0) return;

      // La ligne base d'abord, le fichier ensuite (même ordre que
      // StatusesService.remove) : un fichier orphelin coûte de l'espace
      // disque, une ligne pointant vers un fichier déjà effacé est un bug.
      await this.prisma.status.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });

      await Promise.all(
        expired
          .filter((s): s is { id: string; mediaStorageKey: string } => s.mediaStorageKey !== null)
          .map((s) => this.storage.delete(s.mediaStorageKey)),
      );

      this.logger.log(`${expired.length} statut(s) expiré(s) supprimé(s).`);
    } catch (error) {
      this.logger.warn(
        `Échec du nettoyage des statuts expirés : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
