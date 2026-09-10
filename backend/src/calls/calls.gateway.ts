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
import { GroupCallsGateway } from '../group-calls/group-calls.gateway';
import { GroupCallMessageDto } from '../group-calls/group-calls.service';
import { SocketRateLimiter } from '../websocket/socket-rate-limiter';
import { verifySocketUserId } from '../websocket/socket-auth.util';
import { CallTranslationService } from './call-translation.service';
import { CallMessageDto, CallsService } from './calls.service';

interface InvitePayload {
  conversationId: string;
  calleeId: string;
  /** Absent ou invalide ⇒ AUDIO — voir CallsService.invite(). */
  type?: 'AUDIO' | 'VIDEO';
}
interface CallIdPayload {
  callId: string;
}
interface AcceptPayload extends CallIdPayload {
  /** Langue dans laquelle l'appelé veut entendre l'appelant — absente/vide ⇒ aucune traduction. */
  receiveLanguage?: string | null;
}
interface SetLanguagePayload extends CallIdPayload {
  language: string | null;
}
/** Fragment de la voix locale (~5 s) à transcrire → traduire → synthétiser pour l'autre partie. */
interface SpeechChunkPayload extends CallIdPayload {
  audio: string; // base64
  mimeType: string;
  seq: number;
}
interface EscalatePayload extends CallIdPayload {
  inviteeId: string;
}
/** SDP offer/answer ou candidat ICE — contenu opaque pour le backend, relayé
 * tel quel à l'autre participant sans être interprété (voir relaySignal). */
interface SignalPayload extends CallIdPayload {
  data: unknown;
}

interface SocketData {
  userId?: string;
}

type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

type AckResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Signalisation des appels audio — namespace WebSocket dédié ("/calls"),
 * séparé d'EventsGateway (section 26) plutôt qu'ajouté dedans : CallsService
 * a besoin de NotificationsService (INCOMING_CALL/MISSED_CALL), qui dépend
 * lui-même de WebsocketModule pour diffuser 'notification:new' — les
 * regrouper dans EventsGateway aurait fermé un cycle de modules à trois
 * sauts (Websocket → Calls → Notifications → Websocket) que forwardRef() ne
 * couvre proprement que pour des cycles à deux (voir PresenceModule). Un
 * namespace séparé n'a besoin d'aucune des deux dépendances de
 * EventsGateway : aucun cycle à résoudre.
 *
 * Ne transporte que la signalisation (offre/réponse SDP, candidats ICE) et
 * les changements d'état (accepté/refusé/raccroché/terminé) — jamais le
 * flux audio lui-même, qui passe en pair-à-pair (WebRTC) une fois la
 * connexion établie.
 *
 * @SkipThrottle() : ThrottlerGuard (HTTP) ne peut pas fonctionner dans un
 * contexte WebSocket (voir le commentaire équivalent sur EventsGateway) —
 * ceci retirait toute limite de débit sur la signalisation d'appel sans
 * remplacement. Comblé par SocketRateLimiter (voir actionLimiter/
 * signalLimiter ci-dessous, audit de sécurité).
 */
@Injectable()
@SkipThrottle()
@WebSocketGateway({
  namespace: '/calls',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallsGateway.name);

  // "action" (invite/accept/reject/cancel/end) écrit en base à chaque appel :
  // limite serrée, ces actions restent naturellement rares (une par decision
  // humaine). "signal" (offre/réponse SDP, candidats ICE) peut légitimement
  // rafaler en tout début d'appel (trickle ICE) : limite bien plus large
  // pour ne jamais gêner un appel réel, seulement une boucle/un abus net.
  private readonly actionLimiter = new SocketRateLimiter(20, 10_000);
  private readonly signalLimiter = new SocketRateLimiter(300, 10_000);
  // Un fragment de voix toutes les ~5 s en régime normal : une borne large
  // (mais bien réelle) suffit à couper une boucle/un abus sans jamais gêner
  // un appel légitime, même avec un débit de fragments accéléré.
  private readonly chunkLimiter = new SocketRateLimiter(40, 60_000);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly calls: CallsService,
    private readonly callTranslation: CallTranslationService,
    private readonly groupCallsGateway: GroupCallsGateway,
  ) {}

  async handleConnection(client: AppSocket): Promise<void> {
    try {
      const userId = await verifySocketUserId(client, this.jwt, this.config);
      client.data.userId = userId;
      await client.join(this.userRoom(userId));
    } catch (error) {
      this.logger.warn(
        `Connexion WebSocket (/calls) refusée : ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  /**
   * Fermeture d'onglet, perte réseau... : sans ce garde-fou, l'autre
   * participant resterait bloqué en sonnerie ou en appel indéfiniment.
   */
  async handleDisconnect(client: AppSocket): Promise<void> {
    this.actionLimiter.clear(client.id);
    this.signalLimiter.clear(client.id);
    this.chunkLimiter.clear(client.id);

    const userId = client.data.userId;
    if (!userId) return;

    try {
      const resolved = await this.calls.resolveOrphaned(userId);
      for (const callMessage of resolved) {
        this.callTranslation.clear(callMessage.call.id);
        const otherUserId =
          callMessage.call.callerId === userId
            ? callMessage.call.calleeId
            : callMessage.call.callerId;
        const event = callMessage.call.status === 'MISSED' ? 'call:cancelled' : 'call:ended';
        this.server.to(this.userRoom(otherUserId)).emit(event, callMessage);
      }
    } catch (error) {
      this.logger.warn(
        `Résolution d'appels orphelins en échec pour ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @SubscribeMessage('call:invite')
  async handleInvite(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: InvitePayload,
  ): Promise<AckResult<{ busy: true } | { busy: false; callMessage: CallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const type = body.type === 'VIDEO' ? 'VIDEO' : 'AUDIO';
      const result = await this.calls.invite(userId, body.conversationId, body.calleeId, type);
      if ('busy' in result) return { ok: true, busy: true };
      this.server.to(this.userRoom(result.call.calleeId)).emit('call:incoming', result);
      return { ok: true, busy: false, callMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('call:accept')
  async handleAccept(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: AcceptPayload,
  ): Promise<AckResult<{ callMessage: CallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const result = await this.calls.accept(userId, body.callId);
      this.server.to(this.userRoom(result.call.callerId)).emit('call:accepted', result);

      // Langue de réception choisie par l'appelé sur l'écran d'appel entrant
      // — best-effort : une langue inconnue ne fait jamais échouer la prise
      // d'appel elle-même, elle est simplement ignorée. L'appelant est
      // prévenu (call:language-changed) pour lancer la capture de fragments.
      if (body.receiveLanguage) {
        try {
          await this.callTranslation.setReceiveLanguage(body.callId, userId, body.receiveLanguage);
          this.server.to(this.userRoom(result.call.callerId)).emit('call:language-changed', {
            callId: body.callId,
            userId,
            language: body.receiveLanguage,
          });
        } catch (error) {
          this.logger.warn(
            `Langue de réception d'appel refusée pour ${userId} : ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      // Un appel entrant sonne sur TOUS les appareils connectés de l'appelé
      // (voir handleInvite : diffusion à toute sa room "user:<id>") — les
      // AUTRES appareils que celui qui vient d'accepter doivent cesser de
      // sonner (section 21-22 du cahier des charges : synchronisation
      // multi-appareils). `client.to(...)` exclut automatiquement
      // l'émetteur lui-même (comportement standard Socket.IO), donc
      // uniquement les autres appareils la reçoivent.
      client.to(this.userRoom(userId)).emit('call:resolved-elsewhere', result);
      return { ok: true, callMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('call:reject')
  async handleReject(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ callMessage: CallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const result = await this.calls.reject(userId, body.callId);
      this.callTranslation.clear(body.callId);
      this.server.to(this.userRoom(result.call.callerId)).emit('call:rejected', result);
      // Même principe que dans handleAccept ci-dessus : les autres appareils
      // de l'appelé doivent aussi cesser de sonner.
      client.to(this.userRoom(userId)).emit('call:resolved-elsewhere', result);
      return { ok: true, callMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('call:cancel')
  async handleCancel(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ callMessage: CallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const result = await this.calls.cancel(userId, body.callId);
      this.callTranslation.clear(body.callId);
      this.server.to(this.userRoom(result.call.calleeId)).emit('call:cancelled', result);
      return { ok: true, callMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('call:end')
  async handleEnd(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CallIdPayload,
  ): Promise<AckResult<{ callMessage: CallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const result = await this.calls.end(userId, body.callId);
      this.callTranslation.clear(body.callId);
      const otherUserId =
        result.call.callerId === userId ? result.call.calleeId : result.call.callerId;
      this.server.to(this.userRoom(otherUserId)).emit('call:ended', result);
      return { ok: true, callMessage: result };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  /**
   * "Inviter une personne à rejoindre l'appel" pour un appel simple (1:1) —
   * bascule vers un appel de groupe (voir CallsService.escalateToGroup).
   * Trois diffusions distinctes, chacune vers un namespace/socket différent :
   * l'ack répond à l'initiateur lui-même (sur "/calls", ce socket-ci) ; l'AUTRE
   * partie de l'appel 1:1 d'origine reçoit 'call:upgraded' (toujours sur
   * "/calls" : c'est son useCall qui doit se taire silencieusement, sans le
   * message "Appel terminé.") ; l'invité reçoit le 'group-call:incoming'
   * habituel, mais sur "/group-calls" — d'où l'appel à
   * `groupCallsGateway.notifyIncoming`, cette gateway-ci n'ayant aucun accès
   * à ce namespace-là.
   */
  @SubscribeMessage('call:escalate')
  async handleEscalate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: EscalatePayload,
  ): Promise<AckResult<{ groupCallMessage: GroupCallMessageDto }>> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    try {
      const { otherPartyId, groupCall } = await this.calls.escalateToGroup(
        userId,
        body.callId,
        body.inviteeId,
      );
      this.callTranslation.clear(body.callId);
      this.server.to(this.userRoom(otherPartyId)).emit('call:upgraded', {
        endedCallId: body.callId,
        groupCallMessage: groupCall,
      });
      this.groupCallsGateway.notifyIncoming(groupCall, body.inviteeId);
      return { ok: true, groupCallMessage: groupCall };
    } catch (error) {
      return this.toAckError(error);
    }
  }

  @SubscribeMessage('call:offer')
  async handleOffer(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'call:offer');
  }

  @SubscribeMessage('call:answer')
  async handleAnswer(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'call:answer');
  }

  @SubscribeMessage('call:ice-candidate')
  async handleIceCandidate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'call:ice-candidate');
  }

  /** L'autre participant active/coupe sa caméra en cours d'appel — `data: { enabled: boolean }`, jamais interprété ici, voir relaySignal. */
  @SubscribeMessage('call:video-state')
  async handleVideoState(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SignalPayload,
  ): Promise<void> {
    await this.relaySignal(client, body, 'call:video-state');
  }

  /**
   * L'utilisateur choisit (ou retire, `language: null`) la langue dans
   * laquelle il veut entendre l'autre partie — depuis l'écran d'appel
   * entrant ou le menu en cours d'appel. Diffuse `call:language-changed` à
   * l'autre partie pour qu'elle sache si sa voix va être traduite.
   */
  @SubscribeMessage('call:set-language')
  async handleSetLanguage(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SetLanguagePayload,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'Non authentifié.' };
    if (!this.actionLimiter.consume(client.id)) return this.rateLimited();
    if (!body?.callId) return { ok: false, error: 'Appel inconnu.' };

    const participants = await this.calls.getParticipants(body.callId);
    if (!participants || (participants.callerId !== userId && participants.calleeId !== userId)) {
      return { ok: false, error: 'Vous ne participez pas à cet appel.' };
    }

    try {
      await this.callTranslation.setReceiveLanguage(body.callId, userId, body.language ?? null);
    } catch (error) {
      return this.toAckError(error);
    }

    const otherUserId =
      participants.callerId === userId ? participants.calleeId : participants.callerId;
    this.server.to(this.userRoom(otherUserId)).emit('call:language-changed', {
      callId: body.callId,
      userId,
      language: body.language ?? null,
    });
    return { ok: true };
  }

  /**
   * Fragment de la voix locale de l'émetteur : transcrit → traduit →
   * synthétisé pour l'autre partie, dans la langue qu'elle a choisie
   * (`call:set-language`). Entièrement best-effort — aucun ack, aucune
   * erreur remontée : si rien n'en sort (traduction désactivée, langue non
   * choisie, fournisseur en panne...), l'autre partie garde simplement
   * l'audio d'origine (WebRTC). L'audio de l'appel lui-même ne passe JAMAIS
   * par ici, seulement ces courts fragments dédiés à la traduction.
   */
  @SubscribeMessage('call:speech-chunk')
  async handleSpeechChunk(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: SpeechChunkPayload,
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.callId || typeof body.audio !== 'string') return;
    if (!this.chunkLimiter.consume(client.id)) return;
    if (!this.callTranslation.isEnabled()) return;

    const participants = await this.calls.getParticipants(body.callId);
    if (!participants) return;
    if (participants.callerId !== userId && participants.calleeId !== userId) return;
    const listenerId =
      participants.callerId === userId ? participants.calleeId : participants.callerId;

    const result = await this.callTranslation.processChunk({
      callId: body.callId,
      speakerId: userId,
      listenerId,
      audio: Buffer.from(body.audio, 'base64'),
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm',
    });
    if (!result) return;

    this.server.to(this.userRoom(listenerId)).emit('call:translated-speech', {
      callId: body.callId,
      seq: body.seq,
      text: result.translatedText,
      audio: result.audioBase64,
      mimeType: result.audioMimeType,
    });

    // Sous-titres pour les deux : l'auditeur voit ce que l'autre a dit
    // (traduit), l'émetteur voit sa propre phrase transcrite en confirmation.
    const subtitle = {
      callId: body.callId,
      seq: body.seq,
      speakerId: userId,
      original: result.originalText,
      translated: result.translatedText,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
    };
    this.server.to(this.userRoom(userId)).emit('call:subtitle', subtitle);
    this.server.to(this.userRoom(listenerId)).emit('call:subtitle', subtitle);
  }

  /**
   * Relaie une donnée de signalisation opaque au seul autre participant de
   * l'appel — jamais sans avoir d'abord vérifié que l'émetteur en fait
   * lui-même partie (même logique que relayToOtherMembers dans
   * EventsGateway) : un client ne doit jamais pouvoir injecter une offre ou
   * un candidat ICE dans un appel auquel il ne participe pas.
   */
  private async relaySignal(client: AppSocket, body: SignalPayload, event: string): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.callId) return;
    if (!this.signalLimiter.consume(client.id)) return;

    const participants = await this.calls.getParticipants(body.callId);
    if (!participants) return;
    if (participants.callerId !== userId && participants.calleeId !== userId) return;

    const otherUserId =
      participants.callerId === userId ? participants.calleeId : participants.callerId;
    this.server
      .to(this.userRoom(otherUserId))
      .emit(event, { callId: body.callId, data: body.data });
  }

  /**
   * Notifie l'appelant (et les autres appareils de l'appelé) qu'un appel a
   * été refusé, sans passer par un socket de l'appelé — voir
   * CallsController.quickReject : le refus vient du bouton "Refuser" d'une
   * notification push système, via une requête HTTP directe du service
   * worker, potentiellement sans qu'aucun onglet/appareil de l'appelé ne
   * soit connecté à ce namespace. Même diffusion que handleReject, mais
   * `this.server.to(...)` (jamais `client.to(...)`, il n'y a ici aucun
   * socket émetteur à exclure).
   */
  notifyRejected(callMessage: CallMessageDto): void {
    this.server.to(this.userRoom(callMessage.call.callerId)).emit('call:rejected', callMessage);
    this.server
      .to(this.userRoom(callMessage.call.calleeId))
      .emit('call:resolved-elsewhere', callMessage);
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
      `Erreur inattendue dans un handler d'appel : ${error instanceof Error ? error.message : String(error)}`,
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
