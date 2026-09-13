import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { PushProvider } from './push.provider';

@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushProvider,
  ) {}

  getPublicKey(): { publicKey: string } {
    const publicKey = this.push.getPublicKey();
    if (!publicKey) {
      throw new ServiceUnavailableException('Les notifications push ne sont pas configurées.');
    }
    return { publicKey };
  }

  /** Upsert par `endpoint` (section notifications push) : une resouscription du même appareil/navigateur remplace l'ancienne, jamais un doublon. */
  async subscribe(userId: string, dto: SubscribePushDto, userAgent: string | null): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent,
      },
      // Ré-attribue explicitement userId : si un même endpoint navigateur
      // (rare mais possible après un changement de compte sur le même
      // appareil) était déjà associé à un autre utilisateur, il doit
      // basculer sur l'appelant courant plutôt que de rester orphelin.
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent },
    });
  }

  /** 404-jamais-403 (section 23) : un endpoint qui n'appartient pas à l'appelant est traité comme introuvable. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const subscription = await this.prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (!subscription || subscription.userId !== userId) {
      throw new NotFoundException('Abonnement introuvable.');
    }
    await this.prisma.pushSubscription.delete({ where: { endpoint } });
  }

  /**
   * Associe un jeton FCM à LA session courante (voir AuthenticatedUser.sessionId,
   * jamais à l'utilisateur directement) — chaque appareil mobile a sa
   * propre session et son propre jeton, exactement comme "Appareils
   * connectés" (AuthService.listSessions) distingue déjà les sessions
   * entre elles. `updateMany` (jamais `update`) : une session déjà révoquée
   * entre-temps ne doit pas se voir réattribuer un jeton, silencieusement
   * ignoré plutôt qu'une erreur qui casserait l'app au premier plan.
   */
  async registerFcmToken(sessionId: string, token: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { fcmToken: token },
    });
  }

  async unregisterFcmToken(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId },
      data: { fcmToken: null },
    });
  }
}
