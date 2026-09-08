import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface CallInvitePush {
  callId: string;
  conversationId: string;
  kind: 'AUDIO' | 'VIDEO';
  /** Jeton dédié (voir CallsService), permet de refuser l'appel depuis le
   * bouton d'action de la notification système sans qu'aucune page/onglet
   * ne soit ouvert — jamais un token de session. */
  rejectToken: string;
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
    await this.dispatch(userId, JSON.stringify(message));
  }

  /**
   * Notification d'appel entrant — jamais envoyée via le chemin générique
   * (NotificationsService.create exclut INCOMING_CALL, voir
   * PUSH_EXCLUDED_TYPES) : forme trop différente (actions "Répondre"/
   * "Refuser", `requireInteraction`, `tag` pour remplacer/annuler la
   * notification en cours plutôt que d'en empiler une nouvelle) pour
   * partager PushMessage. Cliquer "Répondre" ouvre l'app sur l'appel (voir
   * `url`, géré par sw.js) ; cliquer "Refuser" appelle POST
   * /calls/quick-reject directement depuis le service worker via
   * `rejectToken`, sans jamais avoir besoin d'ouvrir l'app.
   */
  async sendCallInvite(userId: string, call: CallInvitePush): Promise<void> {
    const payload = JSON.stringify({
      kind: 'call',
      title: 'Glotta',
      body: call.kind === 'VIDEO' ? '📹 Appel vidéo entrant' : '📞 Appel entrant',
      url: `/chat?c=${call.conversationId}&incomingCall=${call.callId}`,
      callId: call.callId,
      rejectToken: call.rejectToken,
    });
    await this.dispatch(userId, payload);
  }

  /**
   * Envoie un payload déjà sérialisé vers tous les abonnements de
   * l'utilisateur, en parallèle, best-effort (jamais d'exception qui
   * remonte à l'appelant — même principe que CloudinaryProvider.delete/
   * StorageService.delete). Un abonnement expiré côté navigateur (404/410)
   * est supprimé silencieusement ; toute autre erreur est seulement loguée.
   */
  private async dispatch(userId: string, payload: string): Promise<void> {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

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
