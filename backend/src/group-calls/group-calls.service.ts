import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CallType,
  GroupCall,
  GroupCallParticipantStatus,
  GroupCallStatus,
  Prisma,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';

const PARTICIPANT_SELECT = {
  userId: true,
  status: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
      profile: { select: { avatarUrl: true, avatarStorageKey: true, avatarStorageProvider: true } },
    },
  },
} satisfies Prisma.GroupCallParticipantSelect;

type ParticipantRow = Prisma.GroupCallParticipantGetPayload<{ select: typeof PARTICIPANT_SELECT }>;

type GroupCallWithParticipants = GroupCall & { participants: ParticipantRow[] };

function toParticipantDto(p: ParticipantRow) {
  return {
    userId: p.userId,
    firstName: p.user.firstName,
    lastName: p.user.lastName,
    avatarUrl: resolveAvatarUrl(p.user.profile, p.userId),
    status: p.status,
  };
}

function toGroupCallDto(call: GroupCallWithParticipants) {
  return {
    id: call.id,
    conversationId: call.conversationId,
    initiatorId: call.initiatorId,
    type: call.type,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    participants: call.participants.map(toParticipantDto),
  };
}

export type GroupCallDto = ReturnType<typeof toGroupCallDto>;

/**
 * Vue "message" d'un appel de groupe — même contrat que CallMessageDto
 * (calls.service.ts) pour l'appel 1:1 : id = messageId, senderId = celui
 * qui a démarré l'appel.
 */
export interface GroupCallMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'GROUP_CALL';
  sentAt: Date;
  createdAt: Date;
  groupCall: GroupCallDto;
}

const GROUP_CALL_INCLUDE = {
  participants: { select: PARTICIPANT_SELECT },
} satisfies Prisma.GroupCallInclude;

/**
 * Appels de groupe — maillage direct (WebRTC pair-à-pair entre chaque
 * participant, jusqu'à 4-5 personnes, voir GroupCallsGateway), volontairement
 * un modèle séparé de Call/CallsService (voir le commentaire sur
 * GroupCall dans schema.prisma) plutôt qu'une généralisation de l'appel 1:1
 * existant, déjà stable et testé.
 *
 * Contrairement à CallsService, aucun push système dédié (bouton Répondre/
 * Refuser hors de l'app) pour cette première passe — seule la notification
 * in-app + la sonnerie temps réel (voir GroupCallsGateway) sont couvertes ;
 * répondre à un appel de groupe suppose donc l'app déjà ouverte. Amélioration
 * possible dans un second temps, comme pour CallsService.sendIncomingCallPush.
 */
@Injectable()
export class GroupCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Démarre un appel de groupe, ou rejoint celui déjà en cours dans cette
   * conversation s'il y en a un (jamais deux appels de groupe actifs
   * simultanément pour la même conversation) — dans ce second cas, se
   * comporte exactement comme join() pour l'appelant.
   */
  async start(
    userId: string,
    conversationId: string,
    type: CallType,
  ): Promise<GroupCallMessageDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { where: { leftAt: null }, select: { userId: true } } },
    });
    const memberIds = conversation?.members.map((m) => m.userId) ?? [];
    if (!conversation || conversation.type !== 'GROUP' || !memberIds.includes(userId)) {
      throw new NotFoundException('Conversation introuvable.');
    }

    const existing = await this.prisma.groupCall.findFirst({
      where: { conversationId, status: 'ACTIVE' },
      include: GROUP_CALL_INCLUDE,
    });
    if (existing) {
      return this.joinExisting(userId, existing);
    }

    const otherMemberIds = memberIds.filter((id) => id !== userId);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        type: 'GROUP_CALL',
        groupCall: {
          create: {
            conversationId,
            initiatorId: userId,
            type,
            participants: {
              create: [
                { userId, status: 'JOINED', joinedAt: new Date() },
                ...otherMemberIds.map((id) => ({ userId: id, status: 'RINGING' as const })),
              ],
            },
          },
        },
      },
      include: { groupCall: { include: GROUP_CALL_INCLUDE } },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const call = message.groupCall;
    if (!call) {
      // Ne devrait jamais arriver : la création imbriquée ci-dessus garantit toujours un GroupCall associé.
      throw new NotFoundException('Appel de groupe introuvable après création.');
    }

    await Promise.all(
      otherMemberIds.map((recipientId) =>
        this.notifications.create(recipientId, 'INCOMING_CALL', {
          conversationId,
          messageId: message.id,
          groupCallId: call.id,
          callerId: userId,
        }),
      ),
    );

    return this.toMessageDto(
      message.id,
      conversationId,
      userId,
      message.sentAt,
      message.createdAt,
      call,
    );
  }

  /**
   * Ajoute des participants à un appel de groupe déjà en cours ("ajouter
   * quelqu'un à l'appel") — seul un participant déjà JOINED peut inviter,
   * jamais quelqu'un qui n'a fait qu'être invité (RINGING) ou qui a refusé/
   * quitté. Un membre déjà invité (RINGING) ou qui a quitté/refusé peut être
   * réinvité (repasse à RINGING) ; un membre déjà JOINED est simplement ignoré.
   */
  async invite(
    userId: string,
    groupCallId: string,
    targetUserIds: string[],
  ): Promise<GroupCallMessageDto> {
    const call = await this.requireActiveCall(groupCallId);
    this.requireJoined(call, userId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: call.conversationId },
      include: { members: { where: { leftAt: null }, select: { userId: true } } },
    });
    const memberIds = new Set(conversation?.members.map((m) => m.userId) ?? []);

    const alreadyJoined = new Set(
      call.participants.filter((p) => p.status === 'JOINED').map((p) => p.userId),
    );
    const toInvite = [...new Set(targetUserIds)].filter(
      (id) => memberIds.has(id) && !alreadyJoined.has(id),
    );

    await Promise.all(
      toInvite.map((targetUserId) =>
        this.prisma.groupCallParticipant.upsert({
          where: { groupCallId_userId: { groupCallId, userId: targetUserId } },
          create: { groupCallId, userId: targetUserId, status: 'RINGING' },
          update: { status: 'RINGING', joinedAt: null, leftAt: null },
        }),
      ),
    );

    await Promise.all(
      toInvite.map((recipientId) =>
        this.notifications.create(recipientId, 'INCOMING_CALL', {
          conversationId: call.conversationId,
          groupCallId: call.id,
          callerId: userId,
        }),
      ),
    );

    return this.toMessageDtoFromCallId(groupCallId);
  }

  /** Renvoie aussi les userId déjà JOINED (hors soi-même) : la base à partir de laquelle le nouveau venu initie ses offres WebRTC (voir GroupCallsGateway). */
  async join(
    userId: string,
    groupCallId: string,
  ): Promise<{ groupCall: GroupCallDto; peerUserIds: string[] }> {
    const call = await this.requireActiveCall(groupCallId);
    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException("Vous n'êtes pas invité à cet appel.");
    }

    await this.prisma.groupCallParticipant.update({
      where: { groupCallId_userId: { groupCallId, userId } },
      data: { status: 'JOINED', joinedAt: new Date(), leftAt: null },
    });

    const updated = await this.toDto(groupCallId);
    const peerUserIds = updated.participants
      .filter((p) => p.status === 'JOINED' && p.userId !== userId)
      .map((p) => p.userId);
    return { groupCall: updated, peerUserIds };
  }

  async decline(userId: string, groupCallId: string): Promise<GroupCallDto> {
    const call = await this.requireActiveCall(groupCallId);
    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException("Vous n'êtes pas invité à cet appel.");
    }

    await this.prisma.groupCallParticipant.update({
      where: { groupCallId_userId: { groupCallId, userId } },
      data: { status: 'DECLINED' },
    });

    return this.toDto(groupCallId);
  }

  /**
   * Quitte un appel de groupe en cours — met fin à l'appel entier
   * (status ENDED) s'il ne reste plus qu'au plus un participant JOINED
   * (un appel de groupe à une seule personne n'a plus de sens).
   */
  async leave(userId: string, groupCallId: string): Promise<GroupCallDto> {
    const call = await this.requireCall(groupCallId);
    if (call.status !== 'ACTIVE') return this.toDto(groupCallId);

    const participant = call.participants.find((p) => p.userId === userId);
    if (participant?.status === 'JOINED') {
      await this.prisma.groupCallParticipant.update({
        where: { groupCallId_userId: { groupCallId, userId } },
        data: { status: 'LEFT', leftAt: new Date() },
      });
    }

    const remaining = call.participants.filter(
      (p) => p.status === 'JOINED' && p.userId !== userId,
    ).length;
    if (remaining <= 1) {
      await this.prisma.groupCall.update({
        where: { id: groupCallId },
        data: { status: 'ENDED', endedAt: new Date() },
      });
    }

    return this.toDto(groupCallId);
  }

  /**
   * Résout tout appel de groupe actif dont l'utilisateur déconnecté est
   * participant JOINED — même principe que CallsService.resolveOrphaned,
   * appelé depuis GroupCallsGateway.handleDisconnect.
   */
  async resolveOrphaned(userId: string): Promise<GroupCallDto[]> {
    const active = await this.prisma.groupCall.findMany({
      where: { status: 'ACTIVE', participants: { some: { userId, status: 'JOINED' } } },
      select: { id: true },
    });
    const resolved: GroupCallDto[] = [];
    for (const { id } of active) {
      resolved.push(await this.leave(userId, id));
    }
    return resolved;
  }

  async getByMessageId(userId: string, messageId: string): Promise<GroupCallMessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { groupCall: { include: GROUP_CALL_INCLUDE } },
    });
    if (!message?.groupCall) {
      throw new NotFoundException('Appel de groupe introuvable.');
    }
    await this.assertMembership(userId, message.conversationId);
    return this.toMessageDto(
      message.id,
      message.conversationId,
      message.senderId,
      message.sentAt,
      message.createdAt,
      message.groupCall,
    );
  }

  /** Utilisé uniquement par GroupCallsGateway pour autoriser/router le relais de signalisation — jamais exposé via une route HTTP. */
  async getParticipantUserIds(groupCallId: string): Promise<Set<string> | null> {
    const call = await this.prisma.groupCall.findUnique({
      where: { id: groupCallId },
      select: { participants: { where: { status: 'JOINED' }, select: { userId: true } } },
    });
    if (!call) return null;
    return new Set(call.participants.map((p) => p.userId));
  }

  private async joinExisting(
    userId: string,
    existing: GroupCallWithParticipants,
  ): Promise<GroupCallMessageDto> {
    await this.prisma.groupCallParticipant.upsert({
      where: { groupCallId_userId: { groupCallId: existing.id, userId } },
      create: { groupCallId: existing.id, userId, status: 'JOINED', joinedAt: new Date() },
      update: { status: 'JOINED', joinedAt: new Date(), leftAt: null },
    });
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: existing.messageId },
      include: { groupCall: { include: GROUP_CALL_INCLUDE } },
    });
    return this.toMessageDto(
      message.id,
      message.conversationId,
      message.senderId,
      message.sentAt,
      message.createdAt,
      message.groupCall!,
    );
  }

  private async toDto(groupCallId: string): Promise<GroupCallDto> {
    const call = await this.requireCall(groupCallId);
    return toGroupCallDto(call);
  }

  /** Reconstruit la forme "message" complète à partir du seul id d'appel — utilisé par invite() : les nouveaux invités doivent recevoir exactement la même forme que group-call:incoming à la création (voir GroupCallsGateway). */
  private async toMessageDtoFromCallId(groupCallId: string): Promise<GroupCallMessageDto> {
    const call = await this.requireCall(groupCallId);
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: call.messageId } });
    return this.toMessageDto(
      message.id,
      message.conversationId,
      message.senderId,
      message.sentAt,
      message.createdAt,
      call,
    );
  }

  private toMessageDto(
    id: string,
    conversationId: string,
    senderId: string,
    sentAt: Date,
    createdAt: Date,
    call: GroupCallWithParticipants,
  ): GroupCallMessageDto {
    return {
      id,
      conversationId,
      senderId,
      type: 'GROUP_CALL',
      sentAt,
      createdAt,
      groupCall: toGroupCallDto(call),
    };
  }

  private async requireCall(groupCallId: string): Promise<GroupCallWithParticipants> {
    const call = await this.prisma.groupCall.findUnique({
      where: { id: groupCallId },
      include: GROUP_CALL_INCLUDE,
    });
    if (!call) {
      throw new NotFoundException('Appel de groupe introuvable.');
    }
    return call;
  }

  private async requireActiveCall(groupCallId: string): Promise<GroupCallWithParticipants> {
    const call = await this.requireCall(groupCallId);
    if (call.status !== 'ACTIVE') {
      throw new ConflictException("Cet appel de groupe n'est plus en cours.");
    }
    return call;
  }

  private requireJoined(call: GroupCallWithParticipants, userId: string): void {
    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant || participant.status !== 'JOINED') {
      throw new ForbiddenException('Vous ne participez pas à cet appel.');
    }
  }

  private async assertMembership(userId: string, conversationId: string): Promise<void> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }
  }
}

export type { GroupCallParticipantStatus, GroupCallStatus };
