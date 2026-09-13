import { Injectable, Logger } from '@nestjs/common';
import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging, type TokenMessage } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { CallInvitePush, PushMessage } from './push.provider';

/**
 * Envoi de notifications push mobiles (FCM — Firebase Cloud Messaging),
 * distinct du web push (VAPID/`PushProvider`) : un navigateur PWA et
 * l'app mobile ne partagent ni le même protocole ni le même jeton, d'où un
 * fournisseur séparé plutôt qu'une branche dans `PushProvider`. Même
 * convention que les autres intégrations optionnelles du projet
 * (`CloudinaryProvider`, `PushProvider` lui-même) : sans
 * `FIREBASE_SERVICE_ACCOUNT`, chaque appelant retombe silencieusement sur
 * "rien n'est envoyé" — in-app/websocket et web push restent inchangés.
 */
@Injectable()
export class FcmProvider {
  private readonly logger = new Logger(FcmProvider.name);
  private messaging: Messaging | null = null;

  constructor(private readonly prisma: PrismaService) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT absent : notifications push mobiles (FCM) désactivées — web push/in-app non affectés.',
      );
      return;
    }
    try {
      const serviceAccount = JSON.parse(raw) as ServiceAccount;
      const app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
      this.messaging = getMessaging(app);
    } catch (error) {
      // Jamais le contenu de FIREBASE_SERVICE_ACCOUNT dans ce log (clé
      // privée) — seulement le fait que le JSON est invalide.
      this.logger.error(
        `FIREBASE_SERVICE_ACCOUNT invalide (JSON illisible ou clé rejetée) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
    }
  }

  isConfigured(): boolean {
    return this.messaging !== null;
  }

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    await this.dispatch(userId, {
      notification: { title: message.title, body: message.body },
      data: { kind: 'notification', url: message.url },
    });
  }

  /**
   * Message de DONNÉES pur (jamais de bloc `notification`) : c'est l'app
   * elle-même qui doit décider comment l'afficher — y compris l'action
   * "Répondre"/"Refuser" — via son gestionnaire d'arrière-plan, jusque
   * dans l'état "tuée" (voir `firebase_messaging` côté mobile). Un bloc
   * `notification` serait affiché tel quel par le système sans jamais
   * passer par ce code, impossible d'y attacher ces actions — même
   * distinction que PushProvider.sendCallInvite côté web.
   */
  async sendCallInvite(userId: string, call: CallInvitePush): Promise<void> {
    await this.dispatch(userId, {
      data: {
        kind: 'call',
        callId: call.callId,
        conversationId: call.conversationId,
        callKind: call.kind,
        rejectToken: call.rejectToken,
      },
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
        payload: { aps: { contentAvailable: true } },
      },
    });
  }

  /**
   * Envoie vers toutes les sessions actives (non révoquées) de
   * l'utilisateur qui ont un jeton FCM enregistré — en parallèle,
   * best-effort (jamais d'exception qui remonte à l'appelant, même
   * principe que PushProvider.dispatch). Un jeton périmé/désinstallé est
   * effacé silencieusement ; toute autre erreur est seulement journalisée.
   */
  private async dispatch(userId: string, message: Omit<TokenMessage, 'token'>): Promise<void> {
    if (!this.messaging) return;

    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });
    if (sessions.length === 0) return;

    await Promise.all(
      sessions.map(async (session) => {
        try {
          await this.messaging!.send({ ...message, token: session.fcmToken! });
        } catch (error) {
          const code = (error as { errorInfo?: { code?: string } }).errorInfo?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            await this.prisma.userSession.update({
              where: { id: session.id },
              data: { fcmToken: null },
            });
            return;
          }
          this.logger.warn(
            `Échec d'envoi FCM pour la session ${session.id} : ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }
}
