import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

/**
 * Envoi de notifications Web Push (PWA — notifications hors de l'app),
 * même convention que les autres fournisseurs optionnels du projet
 * (CloudinaryProvider, les fournisseurs IA — section 38) : sans les 3
 * variables VAPID, chaque appelant retombe silencieusement sur "rien
 * n'est envoyé" plutôt que d'échouer — les notifications in-app/websocket
 * existantes continuent de fonctionner normalement.
 */
@Injectable()
export class PushProvider {
  private readonly logger = new Logger(PushProvider.name);
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    this.configured = Boolean(publicKey && privateKey && subject);
    if (this.configured) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT absents : notifications push désactivées (in-app/websocket non affectées).',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  /**
   * Envoie vers tous les abonnements de l'utilisateur, en parallèle,
   * best-effort (jamais d'exception qui remonte à l'appelant — même
   * principe que CloudinaryProvider.delete/StorageService.delete). Un
   * abonnement expiré côté navigateur (404/410) est supprimé silencieusement
   * ; toute autre erreur est seulement loguée.
   */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify(message);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({
              where: { endpoint: subscription.endpoint },
            });
            return;
          }
          this.logger.warn(
            `Échec d'envoi push vers l'abonnement ${subscription.id} : ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }
}
