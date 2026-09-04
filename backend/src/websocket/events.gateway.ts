import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketRateLimiter } from './socket-rate-limiter';
import { verifySocketUserId } from './socket-auth.util';

interface TypingPayload {
  conversationId: string;
}

interface ConversationOpenedPayload {
  conversationId: string;
}

interface SocketData {
  userId?: string;
}

// Socket.IO type `data` en `any` par défaut : ce paramètre le rend sûr
// (client.data.userId reste typé string | undefined partout ci-dessous).
type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Un seul gateway pour tout le temps réel (présence, messages, traduction —
 * section 26 du cahier des charges). Chaque socket authentifié rejoint une
 * room `user:<id>` : on diffuse toujours vers un utilisateur, jamais vers une
 * room de conversation, pour ne jamais avoir à faire confiance à un client
 * qui prétendrait avoir rejoint la bonne room.
 *
 * @SkipThrottle() : ThrottlerGuard est enregistré globalement (APP_GUARD,
 * section 23) pour les routes HTTP, mais son implémentation part du principe
 * qu'un objet réponse Express existe (`res.header(...)` pour poser les
 * en-têtes X-RateLimit-*) — absent d'un contexte WebSocket. Sans ce
 * décorateur, CHAQUE message entrant (`message:typing` compris) déclenchait
 * une exception ("res.header is not a function") avant même d'atteindre le
 * handler, cassant silencieusement tout le temps réel des indicateurs de
 * frappe en dev/prod (masqué en tests e2e par DISABLE_RATE_LIMITING — voir
 * PHASES.md, bug trouvé en testant l'interface en conditions réelles). Le
 * gateway a de toute façon son propre contrôle d'accès réel (appartenance à
 * la conversation vérifiée en base, voir relayToOtherMembers ci-dessous).
 * Ceci retirait bien une protection réelle (débit) sans remplacement — un
 * trou comblé depuis par SocketRateLimiter (voir typingLimiter/presenceLimiter
 * ci-dessous, audit de sécurité) : le ThrottlerGuard HTTP ne peut pas
 * fonctionner ici, mais l'absence de toute limite sur ces événements n'était
 * pas un choix délibéré.
 */
@Injectable()
@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // Voir socket-rate-limiter.ts : ThrottlerGuard (HTTP) est désactivé sur ce
  // gateway (@SkipThrottle() ci-dessus) et ne protégeait donc plus du tout
  // ces événements (audit de sécurité). "typing" touche la base à chaque
  // appel (relayToOtherMembers) : limite serrée. "presence" reste en mémoire
  // (PresenceService.setOpenConversation) mais garde tout de même une garde,
  // par cohérence et pour borner le CPU en cas de boucle cliente.
  private readonly typingLimiter = new SocketRateLimiter(20, 10_000);
  private readonly presenceLimiter = new SocketRateLimiter(60, 10_000);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: AppSocket): Promise<void> {
    let userId: string;
    try {
      userId = await verifySocketUserId(client, this.jwt, this.config);
      client.data.userId = userId;
      await client.join(this.userRoom(userId));
    } catch (error) {
      this.logger.warn(
        `Connexion WebSocket refusée : ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
      return;
    }

    // Volontairement hors du try/catch d'authentification ci-dessus : un
    // souci de suivi de présence (ex. base de données indisponible) ne doit
    // jamais faire rejeter une connexion pourtant valide, ni — pire —
    // remonter en rejet de promesse non rattrapé et faire tomber tout le
    // process (les deux ont été observés en conditions réelles avant ce
    // garde-fou ; voir PHASES.md).
    try {
      await this.presence.handleSocketConnected(userId, client.id);
    } catch (error) {
      this.logger.warn(
        `Suivi de présence en échec à la connexion pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async handleDisconnect(client: AppSocket): Promise<void> {
    this.typingLimiter.clear(client.id);
    this.presenceLimiter.clear(client.id);

    const userId = client.data.userId;
    if (!userId) return; // jamais authentifié (rejeté dans handleConnection)

    try {
      await this.presence.handleSocketDisconnected(userId, client.id);
    } catch (error) {
      this.logger.warn(
        `Suivi de présence en échec à la déconnexion pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @SubscribeMessage('message:typing')
  async handleTyping(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: TypingPayload,
  ): Promise<void> {
    if (!this.typingLimiter.consume(client.id)) return;
    await this.relayToOtherMembers(client, body, 'message:typing');
  }

  @SubscribeMessage('message:stop_typing')
  async handleStopTyping(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: TypingPayload,
  ): Promise<void> {
    if (!this.typingLimiter.consume(client.id)) return;
    await this.relayToOtherMembers(client, body, 'message:stop_typing');
  }

  /**
   * Déclaré par le client quand une conversation devient effectivement
   * visible à l'écran (section 14-18 : jamais de notification "nouveau
   * message" redondante pour une conversation déjà ouverte) — voir
   * PresenceService.isViewingConversation, consulté par
   * NotificationsService.create(). Aucune vérification d'appartenance ici :
   * ce socket ne fait que déclarer son propre état d'affichage, jamais lu
   * pour un autre id que `client.data.userId` lui-même (voir
   * isViewingConversation), donc rien à exploiter en prétendant regarder
   * une conversation dont on n'est pas membre.
   */
  @SubscribeMessage('conversation:opened')
  handleConversationOpened(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: ConversationOpenedPayload,
  ): void {
    if (!client.data.userId || !body?.conversationId) return;
    if (!this.presenceLimiter.consume(client.id)) return;
    this.presence.setOpenConversation(client.id, body.conversationId);
  }

  @SubscribeMessage('conversation:closed')
  handleConversationClosed(@ConnectedSocket() client: AppSocket): void {
    if (!client.data.userId) return;
    if (!this.presenceLimiter.consume(client.id)) return;
    this.presence.setOpenConversation(client.id, null);
  }

  /** Utilisé par MessagesService (et modules futurs) pour pousser un événement à un utilisateur. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(this.userRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, payload);
    }
  }

  /**
   * Ne relaie l'événement qu'aux autres membres actifs de la conversation, et
   * seulement si l'émetteur en est lui-même membre (section 23) — un client
   * malveillant ne peut pas faire croire qu'il "écrit" dans une conversation
   * dont il ne fait pas partie.
   */
  private async relayToOtherMembers(
    client: AppSocket,
    body: TypingPayload,
    event: string,
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.conversationId) return;

    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: body.conversationId, userId } },
    });
    if (!membership || membership.leftAt) return;

    const otherMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId: body.conversationId, leftAt: null, userId: { not: userId } },
      select: { userId: true },
    });

    for (const member of otherMembers) {
      this.server
        .to(this.userRoom(member.userId))
        .emit(event, { conversationId: body.conversationId, userId });
    }
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }
}
