import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../websocket/events.gateway';

export interface PresenceInfo {
  isOnline: boolean;
  lastSeenAt: Date | null;
}

/**
 * Le statut "en ligne" est dérivé des sockets WebSocket réellement connectés
 * (en mémoire, par instance de serveur) — jamais persisté en base, pour ne
 * jamais afficher un état qui pourrait mentir après un crash ou un restart.
 * Seule `lastSeenAt` (dernière déconnexion) est écrite en base.
 *
 * Limite connue : cette présence en mémoire ne fonctionne que pour une seule
 * instance de serveur. Un déploiement multi-instances devra remplacer cette
 * Map par un registre partagé (Redis), déjà prévu dans l'infrastructure
 * (docker-compose.yml) mais pas encore branché ici.
 */
@Injectable()
export class PresenceService {
  private readonly connections = new Map<string, Set<string>>();
  // socketId -> conversationId actuellement affichée par ce socket précis
  // (jamais par utilisateur : un même utilisateur peut avoir plusieurs
  // appareils connectés, chacun regardant un écran différent — voir
  // isViewingConversation ci-dessous, qui considère l'utilisateur comme
  // "en train de regarder" dès qu'AU MOINS un de ses sockets l'a ouverte).
  // Alimente la suppression de notification redondante (section 14-18 du
  // cahier des charges) : NotificationsService.create() ne crée jamais de
  // notification "nouveau message" pour une conversation déjà à l'écran.
  private readonly openConversationBySocket = new Map<string, string>();
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
  ) {}

  async handleSocketConnected(userId: string, socketId: string): Promise<void> {
    const wasOnline = this.isOnline(userId);

    let sockets = this.connections.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.connections.set(userId, sockets);
    }
    sockets.add(socketId);

    if (!wasOnline) {
      await this.broadcastPresence(userId, true);
    }
  }

  async handleSocketDisconnected(userId: string, socketId: string): Promise<void> {
    this.openConversationBySocket.delete(socketId);

    const sockets = this.connections.get(userId);
    sockets?.delete(socketId);
    if (sockets && sockets.size > 0) return; // encore un autre appareil connecté

    this.connections.delete(userId);

    try {
      await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
    } catch (error) {
      // Ne doit jamais faire tomber le gateway pour un simple horodatage.
      this.logger.warn(
        `Échec de l'enregistrement de lastSeenAt pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.broadcastPresence(userId, false);
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  /** Un socket ne peut regarder qu'une conversation à la fois — appelé sur
   * "conversation:opened" (voir EventsGateway) ; `null` marque la fermeture
   * (retour à un autre écran). */
  setOpenConversation(socketId: string, conversationId: string | null): void {
    if (conversationId) this.openConversationBySocket.set(socketId, conversationId);
    else this.openConversationBySocket.delete(socketId);
  }

  /** Vrai dès qu'au moins un appareil connecté de cet utilisateur a
   * actuellement cette conversation à l'écran — voir NotificationsService.create(). */
  isViewingConversation(userId: string, conversationId: string): boolean {
    const sockets = this.connections.get(userId);
    if (!sockets) return false;
    for (const socketId of sockets) {
      if (this.openConversationBySocket.get(socketId) === conversationId) return true;
    }
    return false;
  }

  /**
   * Vue "présence" telle que la voit un autre utilisateur — respecte
   * `Profile.showOnlineStatus` / `showLastSeen` (section 22). Passer
   * `respectPrivacy: false` uniquement pour le propriétaire du compte
   * lui-même (ses propres réglages ne doivent jamais lui être cachés).
   */
  async getPresence(userId: string, respectPrivacy = true): Promise<PresenceInfo> {
    const [profile, user] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { lastSeenAt: true } }),
    ]);

    const hideOnlineStatus = respectPrivacy && profile?.showOnlineStatus === false;
    const hideLastSeen = respectPrivacy && profile?.showLastSeen === false;

    return {
      isOnline: hideOnlineStatus ? false : this.isOnline(userId),
      lastSeenAt: hideLastSeen ? null : (user?.lastSeenAt ?? null),
    };
  }

  /**
   * Best-effort : une notification de présence manquée est sans conséquence
   * grave (le client la retrouvera à sa prochaine requête REST), donc une
   * panne base de données ici ne doit jamais remonter — sans ce garde-fou,
   * une connexion pourtant authentifiée serait rejetée (handleConnection) ou
   * pire, une erreur non rattrapée dans handleDisconnect ferait tomber tout
   * le process Node (vérifié en conditions réelles : voir PHASES.md).
   */
  private async broadcastPresence(userId: string, online: boolean): Promise<void> {
    try {
      const profile = await this.prisma.profile.findUnique({ where: { userId } });
      if (profile?.showOnlineStatus === false) return; // rien à diffuser si désactivé

      const peers = await this.getConversationPeers(userId);
      if (peers.length === 0) return;

      this.events.emitToUsers(peers, online ? 'user:online' : 'user:offline', {
        userId,
        lastSeenAt: online ? null : new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Échec de la diffusion de présence pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getConversationPeers(userId: string): Promise<string[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });
    const conversationIds = memberships.map((m) => m.conversationId);
    if (conversationIds.length === 0) return [];

    const others = await this.prisma.conversationMember.findMany({
      where: { conversationId: { in: conversationIds }, userId: { not: userId }, leftAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return others.map((o) => o.userId);
  }
}
