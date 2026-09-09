import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Call, CallStatus, CallType, Prisma } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { GroupCallMessageDto, GroupCallsService } from '../group-calls/group-calls.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider } from '../push/push.provider';
import { resolveAvatarUrl } from '../profiles/avatar.util';

const CALL_HISTORY_PAGE_SIZE = 30;

/** Purpose claim du jeton d'action d'appel (voir mintQuickRejectToken/quickReject) — jamais confondu avec un access/refresh token classique (secret dédié, voir CALL_ACTION_JWT_SECRET). */
const CALL_REJECT_TOKEN_PURPOSE = 'call-reject';
/** Généreux (bien plus qu'une sonnerie réelle) : l'utilisateur peut ne remarquer/toucher la notification système que plusieurs minutes après — reject() revalide de toute façon le statut RINGING côté serveur, un jeton encore valide sur un appel déjà résolu ne fait donc jamais de mal. */
const CALL_REJECT_TOKEN_TTL = '10m';

interface CallRejectTokenPayload {
  sub: string;
  callId: string;
  purpose: string;
}

const CALL_HISTORY_PARTICIPANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  profile: { select: { avatarUrl: true, avatarStorageKey: true } },
} satisfies Prisma.UserSelect;

interface HistoryParticipant {
  id: string;
  firstName: string;
  lastName: string;
  profile: { avatarUrl: string | null; avatarStorageKey: string | null } | null;
}

function toHistoryEntry(
  call: Call & {
    message: { conversationId: string };
    caller: HistoryParticipant;
    callee: HistoryParticipant;
  },
  userId: string,
) {
  const iAmCaller = call.callerId === userId;
  const other = iAmCaller ? call.callee : call.caller;
  return {
    id: call.id,
    messageId: call.messageId,
    conversationId: call.message.conversationId,
    direction: iAmCaller ? ('outgoing' as const) : ('incoming' as const),
    type: call.type,
    status: call.status,
    startedAt: call.startedAt,
    durationSeconds:
      call.answeredAt && call.endedAt
        ? Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000)
        : null,
    otherUser: {
      id: other.id,
      firstName: other.firstName,
      lastName: other.lastName,
      avatarUrl: resolveAvatarUrl(other.profile, other.id),
    },
  };
}

export type CallHistoryEntry = ReturnType<typeof toHistoryEntry>;

type CallWithMessage = Call & {
  message: { conversationId: string; senderId: string; sentAt: Date; createdAt: Date };
};

function toCallDto(call: Call) {
  return {
    id: call.id,
    messageId: call.messageId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    type: call.type,
    status: call.status,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    durationSeconds:
      call.answeredAt && call.endedAt
        ? Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000)
        : null,
  };
}

export type CallDto = ReturnType<typeof toCallDto>;

/**
 * Vue "message" d'un appel — mêmes champs de base qu'un MessageDto ordinaire
 * (id = messageId, conversationId, senderId = l'appelant, sentAt, createdAt)
 * plus le détail de l'appel. Jamais renvoyé par MessagesService : comme pour
 * VoiceMessage (voir VoiceService.getDetails), récupéré à la demande via
 * GET /calls/message/:messageId, ou reçu tel quel via les événements du
 * namespace WebSocket "/calls" (voir CallsGateway).
 */
export interface CallMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'CALL';
  sentAt: Date;
  createdAt: Date;
  call: CallDto;
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly push: PushProvider,
    private readonly contacts: ContactsService,
    private readonly groupCalls: GroupCallsService,
  ) {}

  /**
   * Démarre un appel — crée le Message (type CALL) et son Call imbriqué en
   * une seule écriture, exactement comme MessagesService.send() pour les
   * autres types. Renvoie `{ busy: true }` sans rien écrire si l'appelé
   * participe déjà à un autre appel : ce n'est pas une erreur, juste un état
   * que l'appelant doit afficher (voir CallsGateway).
   */
  async invite(
    callerId: string,
    conversationId: string,
    calleeId: string,
    type: CallType = 'AUDIO',
  ): Promise<{ busy: true } | CallMessageDto> {
    if (callerId === calleeId) {
      throw new ForbiddenException("Impossible de s'appeler soi-même.");
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { where: { leftAt: null }, select: { userId: true } } },
    });
    const memberIds = conversation?.members.map((m) => m.userId) ?? [];
    if (
      !conversation ||
      conversation.type !== 'DIRECT' ||
      !memberIds.includes(callerId) ||
      !memberIds.includes(calleeId)
    ) {
      throw new NotFoundException('Conversation introuvable.');
    }

    const busy = await this.prisma.call.findFirst({
      where: {
        status: { in: ['RINGING', 'ACTIVE'] },
        OR: [{ callerId: calleeId }, { calleeId }],
      },
    });
    if (busy) return { busy: true };

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: callerId,
        type: 'CALL',
        call: { create: { callerId, calleeId, type, status: 'RINGING' } },
      },
      include: { call: true },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const call = message.call;
    if (!call) {
      // Ne devrait jamais arriver : la création imbriquée ci-dessus garantit
      // toujours un Call associé à ce message.
      throw new NotFoundException('Appel introuvable après création.');
    }

    await this.notifications.create(calleeId, 'INCOMING_CALL', {
      conversationId,
      messageId: message.id,
      callId: call.id,
      callerId,
    });

    // Fire-and-forget, comme les autres envois push best-effort du projet
    // (voir NotificationsService.create) : réveille l'appelé même si son
    // application est totalement fermée (aucun socket "/calls" connecté,
    // donc l'événement 'call:incoming' émis par CallsGateway ne va nulle
    // part) — sans ce push, un appel vers quelqu'un hors de l'app ne
    // sonnerait jamais chez lui.
    void this.sendIncomingCallPush(calleeId, call.id, conversationId, type);

    return this.toDto(
      message.id,
      conversationId,
      callerId,
      message.sentAt,
      message.createdAt,
      call,
    );
  }

  async accept(userId: string, callId: string): Promise<CallMessageDto> {
    const call = await this.requireCall(callId);
    if (call.calleeId !== userId) {
      throw new ForbiddenException('Cet appel ne vous est pas destiné.');
    }
    if (call.status !== 'RINGING') {
      throw new ConflictException("Cet appel n'est plus en attente de réponse.");
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'ACTIVE', answeredAt: new Date() },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    return this.fromUpdated(updated);
  }

  async reject(userId: string, callId: string): Promise<CallMessageDto> {
    const call = await this.requireCall(callId);
    if (call.calleeId !== userId) {
      throw new ForbiddenException('Cet appel ne vous est pas destiné.');
    }
    if (call.status !== 'RINGING') {
      throw new ConflictException("Cet appel n'est plus en attente de réponse.");
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'DECLINED', endedAt: new Date() },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    return this.fromUpdated(updated);
  }

  /** L'appelant raccroche avant toute réponse (ou expiration côté client) — compté comme manqué pour l'appelé. */
  async cancel(userId: string, callId: string): Promise<CallMessageDto> {
    const call = await this.requireCall(callId);
    if (call.callerId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas à l'origine de cet appel.");
    }
    if (call.status !== 'RINGING') {
      throw new ConflictException("Cet appel n'est plus en attente de réponse.");
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'MISSED', endedAt: new Date() },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    await this.notifyMissed(updated);
    return this.fromUpdated(updated);
  }

  async end(userId: string, callId: string): Promise<CallMessageDto> {
    const call = await this.requireCall(callId);
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new ForbiddenException('Vous ne participez pas à cet appel.');
    }
    if (call.status !== 'ACTIVE') {
      throw new ConflictException("Cet appel n'est plus en cours.");
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'ENDED', endedAt: new Date() },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    return this.fromUpdated(updated);
  }

  /**
   * Bascule un appel 1:1 ACTIVE en appel de groupe pour y inviter une
   * troisième personne ("appels simples : pouvoir inviter quelqu'un à
   * rejoindre l'appel") — les deux systèmes d'appel (1:1 et groupe) restent
   * volontairement séparés (voir le commentaire de classe de
   * GroupCallsService), donc pas de généralisation de Call en GroupCall à N=2 :
   * on transforme ponctuellement l'un en l'autre au moment de l'invitation,
   * jamais avant.
   *
   * L'appel 1:1 d'origine passe ENDED (pas DECLINED/MISSED : il s'est bien
   * déroulé, il ne fait que continuer sous une autre forme) — le nouveau
   * message GROUP_CALL apparaît juste après dans le même fil.
   *
   * L'invité doit être un contact accepté de l'initiateur : ni lui ni
   * l'autre partie de l'appel 1:1 ne sont membres de cette conversation
   * DIRECT (section 23, 404-jamais-403 — mais ici il ne s'agit même pas
   * d'appartenance à vérifier, l'invité n'a simplement aucun lien avec cette
   * conversation avant d'y être explicitement invité), donc aucune
   * vérification de membership ne serait pertinente ; le contact accepté est
   * la seule frontière de confiance qui a du sens ici.
   */
  async escalateToGroup(
    userId: string,
    callId: string,
    inviteeId: string,
  ): Promise<{ otherPartyId: string; groupCall: GroupCallMessageDto }> {
    const call = await this.requireCall(callId);
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new ForbiddenException('Vous ne participez pas à cet appel.');
    }
    if (call.status !== 'ACTIVE') {
      throw new ConflictException("Cet appel n'est plus en cours.");
    }
    const otherPartyId = call.callerId === userId ? call.calleeId : call.callerId;
    if (inviteeId === userId || inviteeId === otherPartyId) {
      throw new ForbiddenException('Cette personne participe déjà à cet appel.');
    }
    const isContact = await this.contacts.areContacts(userId, inviteeId);
    if (!isContact) {
      throw new ForbiddenException('Seuls vos contacts peuvent être invités à rejoindre un appel.');
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'ENDED', endedAt: new Date() },
      include: {
        message: { select: { conversationId: true } },
      },
    });

    const groupCall = await this.groupCalls.startFromEscalation(
      userId,
      updated.message.conversationId,
      updated.type,
      [call.callerId, call.calleeId],
      inviteeId,
    );

    return { otherPartyId, groupCall };
  }

  /**
   * Résout tout appel resté ouvert (RINGING ou ACTIVE) pour un utilisateur
   * dont le socket "/calls" vient de se déconnecter — sans quoi une fermeture
   * d'onglet en pleine sonnerie ou en plein appel laisserait l'autre partie
   * bloquée indéfiniment. Appelé depuis CallsGateway.handleDisconnect.
   */
  async resolveOrphaned(userId: string): Promise<CallMessageDto[]> {
    const orphaned = await this.prisma.call.findMany({
      where: {
        status: { in: ['RINGING', 'ACTIVE'] },
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
    });

    const resolved: CallMessageDto[] = [];
    for (const call of orphaned) {
      const status: CallStatus = call.status === 'RINGING' ? 'MISSED' : 'ENDED';
      const updated = await this.prisma.call.update({
        where: { id: call.id },
        data: { status, endedAt: new Date() },
        include: {
          message: {
            select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
          },
        },
      });
      if (status === 'MISSED') {
        await this.notifyMissed(updated);
      }
      resolved.push(this.fromUpdated(updated));
    }
    return resolved;
  }

  /** Utilisé uniquement par CallsGateway pour autoriser/router le relais de signalisation (offre/réponse/ICE) — jamais exposé via une route HTTP. */
  async getParticipants(callId: string): Promise<{ callerId: string; calleeId: string } | null> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { callerId: true, calleeId: true },
    });
    return call;
  }

  /** Historique des appels de l'utilisateur, tous fils de discussion confondus — alimente le panneau "Appels" de la navigation. */
  async listForUser(
    userId: string,
    cursor?: string,
    limit = CALL_HISTORY_PAGE_SIZE,
  ): Promise<{ items: CallHistoryEntry[]; nextCursor: string | null }> {
    const rows = await this.prisma.call.findMany({
      where: { OR: [{ callerId: userId }, { calleeId: userId }] },
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        message: { select: { conversationId: true } },
        caller: { select: CALL_HISTORY_PARTICIPANT_SELECT },
        callee: { select: CALL_HISTORY_PARTICIPANT_SELECT },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((call) => toHistoryEntry(call, userId)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Reprise d'un appel entrant après ouverture de l'app depuis l'action
   * "Répondre" d'une notification push système (voir sw.js / chat/page.tsx,
   * `?incomingCall=<callId>`) — le callee n'a reçu aucun événement
   * `call:incoming` en temps réel puisque son socket "/calls" n'existait pas
   * encore à l'invitation. 404-jamais-403 (section 23) : un appel qui ne le
   * concerne pas est traité comme introuvable, jamais distingué d'un appel
   * inexistant.
   */
  async getById(userId: string, callId: string): Promise<CallMessageDto> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
      throw new NotFoundException('Appel introuvable.');
    }
    return this.fromUpdated(call);
  }

  /**
   * Refuse un appel à partir du jeton d'action embarqué dans la notification
   * push (bouton "Refuser") — jamais via JwtAuthGuard (voir CallsController) :
   * appelé directement par le service worker, à un moment où l'utilisateur
   * n'a peut-être aucune page ouverte donc aucun accessToken de session
   * disponible (celui-ci ne vit qu'en localStorage, inaccessible depuis un
   * service worker). Le jeton lui-même porte l'identité et le périmètre
   * (userId + callId précis), signé avec un secret dédié distinct de
   * JWT_ACCESS_SECRET pour qu'il ne puisse jamais être rejoué comme un
   * access token classique sur une autre route.
   */
  async quickReject(token: string): Promise<CallMessageDto> {
    let payload: CallRejectTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<CallRejectTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('CALL_ACTION_JWT_SECRET'),
      });
    } catch {
      throw new NotFoundException('Jeton invalide ou expiré.');
    }
    if (payload.purpose !== CALL_REJECT_TOKEN_PURPOSE) {
      throw new NotFoundException('Jeton invalide ou expiré.');
    }
    return this.reject(payload.sub, payload.callId);
  }

  async getByMessageId(userId: string, messageId: string): Promise<CallMessageDto> {
    const call = await this.prisma.call.findUnique({
      where: { messageId },
      include: {
        message: {
          select: { conversationId: true, senderId: true, sentAt: true, createdAt: true },
        },
      },
    });
    if (!call) {
      throw new NotFoundException('Appel introuvable.');
    }
    await this.assertMembership(userId, call.message.conversationId);
    return this.fromUpdated(call);
  }

  /**
   * STUN public (Google, gratuit) toujours inclus ; TURN de secours
   * configurable via .env (défaut : Open Relay Project, service TURN public
   * et gratuit — voir .env.example) pour les paires d'appareils que le STUN
   * seul ne peut pas connecter (NAT symétrique, réseaux d'entreprise...).
   */
  iceServers(): IceServer[] {
    const stunUrls = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const servers: IceServer[] = [{ urls: stunUrls }];

    const turnUrls = (
      process.env.TURN_URLS ??
      'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turn:openrelay.metered.ca:443?transport=tcp'
    )
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (turnUrls.length > 0) {
      servers.push({
        urls: turnUrls,
        username: process.env.TURN_USERNAME ?? 'openrelayproject',
        credential: process.env.TURN_CREDENTIAL ?? 'openrelayproject',
      });
    }
    return servers;
  }

  private async sendIncomingCallPush(
    calleeId: string,
    callId: string,
    conversationId: string,
    kind: CallType,
  ): Promise<void> {
    const rejectToken = await this.jwt.signAsync(
      { sub: calleeId, callId, purpose: CALL_REJECT_TOKEN_PURPOSE },
      {
        secret: this.config.getOrThrow<string>('CALL_ACTION_JWT_SECRET'),
        expiresIn: CALL_REJECT_TOKEN_TTL,
      },
    );
    await this.push.sendCallInvite(calleeId, { callId, conversationId, kind, rejectToken });
  }

  private async notifyMissed(call: CallWithMessage): Promise<void> {
    await this.notifications.create(call.calleeId, 'MISSED_CALL', {
      conversationId: call.message.conversationId,
      messageId: call.messageId,
      callId: call.id,
      callerId: call.callerId,
    });
  }

  private async requireCall(callId: string): Promise<Call> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException('Appel introuvable.');
    }
    return call;
  }

  private async assertMembership(userId: string, conversationId: string): Promise<void> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }
  }

  private fromUpdated(call: CallWithMessage): CallMessageDto {
    return this.toDto(
      call.messageId,
      call.message.conversationId,
      call.message.senderId,
      call.message.sentAt,
      call.message.createdAt,
      call,
    );
  }

  private toDto(
    id: string,
    conversationId: string,
    senderId: string,
    sentAt: Date,
    createdAt: Date,
    call: Call,
  ): CallMessageDto {
    return { id, conversationId, senderId, type: 'CALL', sentAt, createdAt, call: toCallDto(call) };
  }
}
