import { HttpException, Injectable, Logger } from '@nestjs/common';
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
import { SocketRateLimiter } from '../websocket/socket-rate-limiter';
import { verifySocketUserId } from '../websocket/socket-auth.util';
import { GroupCallDto, GroupCallMessageDto, GroupCallsService } from './group-calls.service';

interface StartPayload {
  conversationId: string;
  type?: 'AUDIO' | 'VIDEO';
}
interface CallIdPayload {
  groupCallId: string;
}
interface InvitePayload extends CallIdPayload {
  userIds: string[];
}
/** SDP offer/answer ou candidat ICE, ciblé vers UN pair précis (maillage — voir relaySignal) — contenu opaque pour le backend. */
interface SignalPayload extends CallIdPayload {
  targetUserId: string;
  data: unknown;
}

interface SocketData {
  userId?: string;
}

type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

type AckResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Signalisation des appels de groupe — namespace WebSocket dédié
 * ("/group-calls"), séparé de CallsGateway (1:1) et d'EventsGateway pour
 * les mêmes raisons qu'eux (voir le commentaire en tête de calls.gateway.ts) :
 * aucun cycle de modules à résoudre.
 *
 * Topologie maillée (jusqu'à 4-5 participants) : chaque paire de
 * participants négocie sa propre connexion WebRTC directe, jamais relayée
 * par le serveur au-delà de la signalisation (offre/réponse SDP, candidats
 * ICE) — voir relaySignal, qui route chaque message vers UN seul
 * destinataire (`targetUserId`), contrairement à CallsGateway qui n'a
 * jamais besoin de cibler puisqu'il n'y a qu'un seul "autre".
 *
 * Convention pour éviter tout "glare" (offres concurrentes) : c'est
 * TOUJOURS celui qui rejoint (voir handleJoin, qui renvoie `peerUserIds`)
 * qui initie une offre vers chaque participant déjà présent — jamais
 * l'inverse. Les participants déjà là n'ont donc qu'à répondre aux offres
 * qu'ils reçoivent, jamais à en émettre eux-mêmes pour un nouveau venu.
 */
@Injectable()
@SkipThrottle()
@WebSocketGateway({
  namespace: '/group-calls',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class GroupCallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GroupCallsGateway.name);

  // Même principe que CallsGateway : "action" (start/invite/join/decline/
  // leave) reste rare, "signal" (offre/réponse/ICE) peut légitimement
  // rafaler — et d'autant plus ici qu'un maillage à N participants multiplie
  // le nombre de messages de signalisation par rapport à un appel 1:1.
  private readonly actionLimiter = new SocketRateLimiter(20, 10_000);
  private readonly signalLimiter = new SocketRateLimiter(600, 10_000);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly groupCalls: GroupCallsService,
  ) {}

  async handleConnection(client: AppSocket): Promise<void> {
    try {
      const userId = await verifySocketUserId(client, this.jwt, this.config);
      client.data.userId = userId;
      await client.join(this.userRoom(userId));
    } catch (error) {
      this.logger.warn(
        `Connexion WebSocket (/group-calls) refusée : ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  /** Sans ce garde-fou, fermer l'onglet en pleine sonnerie/en plein appel laisserait les autres participants bloqués indéfiniment (même principe que CallsGateway). */
  async handleDisconnect(client: AppSocket): Promise<void> {
    this.actionLimiter.clear(client.id);
    this.signalLimiter.clear(client.id);

    const userId = client.data.userId;
    if (!userId) return;

    try {
      const resolved = await this.groupCalls.resolveOrphaned(userId);
      for (const call of resolved) {
        this.broadcastToParticipants(call, 'group-call:participant-left', {
          groupCallId: call.id,
          userId,
          call,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Résolution d'appels de groupe orphelins en échec pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @SubscribeMessage('group-call:start')
  async handleStart(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: StartPayload,
  ): Promise<AckResult<{ groupCallMessage: GroupCallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const type = body.type === 'VIDEO' ? 'VIDEO' : 'AUDIO';
      const result = await this.groupCalls.start(userId, body.conversationId, type);
      // RINGING uniquement : un participant déjà JOINED (l'appelant, ou
      // quelqu'un qui rejoignait un appel déjà en cours) a déjà l'état à
      // jour via son propre ack, jamais besoin de le sonner lui-même.
      const ringing = result.groupCall.participants.filter((p) => p.status === 'RINGING');
      for (const p of ringing) {
        this.server.to(this.userRoom(p.userId)).emit('group-call:incoming', result);
      }
      return { ok: true, groupCallMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('group-call:invite')
  async handleInvite(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: InvitePayload,
  ): Promise<AckResult<{ groupCallMessage: GroupCallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const result = await this.groupCalls.invite(userId, body.groupCallId, body.userIds ?? []);
      const invitedIds = new Set(body.userIds ?? []);
      const newlyRinging = result.groupCall.participants.filter(
        (p) => p.status === 'RINGING' && invitedIds.has(p.userId),
      );
      for (const p of newlyRinging) {
        this.server.to(this.userRoom(p.userId)).emit('group-call:incoming', result);
      }
      this.broadcastToParticipants(result.groupCall, 'group-call:updated', {
        groupCallId: result.groupCall.id,
        call: result.groupCall,
      });
      return { ok: true, groupCallMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('group-call:join')
  async handleJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ call: GroupCallDto; peerUserIds: string[] }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const { groupCall, peerUserIds } = await this.groupCalls.join(userId, body.groupCallId);
      // Annoncé pour l'UI des autres participants (afficher la tuile du
      // nouveau venu tout de suite) — jamais nécessaire à la signalisation
      // WebRTC elle-même, qui démarre dès que ce nouveau venu émet ses
      // propres offres (voir relaySignal), pas en réponse à cet événement.
      this.broadcastToParticipants(groupCall, 'group-call:participant-joined', {
        groupCallId: groupCall.id,
        userId,
        call: groupCall,
      });
      return { ok: true, call: groupCall, peerUserIds };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('group-call:decline')
  async handleDecline(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ call: GroupCallDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const call = await this.groupCalls.decline(userId, body.groupCallId);
      this.broadcastToParticipants(call, 'group-call:participant-declined', {
        groupCallId: call.id,
        userId,
        call,
      });
      return { ok: true, call };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('group-call:leave')
  async handleLeave(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ call: GroupCallDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const call = await this.groupCalls.leave(userId, body.groupCallId);
      this.broadcastToParticipants(call, 'group-call:participant-left', {
        groupCallId: call.id,
        userId,
        call,
      });
      return { ok: true, call };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('group-call:offer')
  async handleOffer(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'group-call:offer');
  }

  @SubscribeMessage('group-call:answer')
  async handleAnswer(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'group-call:answer');
  }

  @SubscribeMessage('group-call:ice-candidate')
  async handleIceCandidate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'group-call:ice-candidate');
  }

  /**
   * Relaie une donnée de signalisation opaque vers UN participant précis
   * (`targetUserId`) — jamais sans avoir vérifié que l'émetteur ET la cible
   * font tous les deux partie des participants JOINED de cet appel (même
   * logique que CallsGateway.relaySignal, étendue au ciblage par pair).
   */
  private async relaySignal(client: AppSocket, body: SignalPayload, event: string): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.groupCallId || !body.targetUserId) return;
    if (!this.signalLimiter.consume(client.id)) return;

    const joined = await this.groupCalls.getParticipantUserIds(body.groupCallId);
    if (!joined || !joined.has(userId) || !joined.has(body.targetUserId)) return;

    this.server
      .to(this.userRoom(body.targetUserId))
      .emit(event, { groupCallId: body.groupCallId, senderUserId: userId, data: body.data });
  }

  private broadcastToParticipants(call: GroupCallDto, event: string, payload: unknown): void {
    for (const p of call.participants) {
      this.server.to(this.userRoom(p.userId)).emit(event, payload);
    }
  }

  private toAckError(error: unknown): { ok: false; error: string } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const rawMessage =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? error.message);
      return { ok: false, error: Array.isArray(rawMessage) ? rawMessage.join(' ') : rawMessage };
    }
    this.logger.error(
      `Erreur inattendue dans un handler d'appel de groupe : ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, error: 'Une erreur est survenue.' };
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private rateLimited(): { ok: false; error: string } {
    return { ok: false, error: 'Trop de requêtes, réessayez dans quelques secondes.' };
  }
}
