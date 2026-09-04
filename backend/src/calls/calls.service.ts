import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Call, CallStatus, CallType, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';

const CALL_HISTORY_PAGE_SIZE = 30;

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
