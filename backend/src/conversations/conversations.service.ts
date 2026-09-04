import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WhoCanInteract } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { UpdateConversationMembershipDto } from './dto/update-conversation-membership.dto';

const DEFAULT_PAGE_SIZE = 30;

const CONVERSATION_INCLUDE = {
  members: {
    where: { leftAt: null },
    include: { user: { include: { profile: true } } },
  },
  // Dernier message uniquement : la liste complète est paginée par
  // MessagesModule (phase 5). Reste `null` tant qu'aucun message n'existe
  // encore — rien à changer ici quand la phase 5 sera posée.
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    // Nécessaire seulement pour type CALL — voir toDetail() ci-dessous, qui
    // en tire un résumé (statut, durée) pour l'aperçu de la liste de
    // conversations, faute de quoi "Appel manqué"/"Appel · 2:14" ne
    // pourrait pas s'afficher sans une requête séparée par conversation.
    include: {
      call: { select: { type: true, status: true, answeredAt: true, endedAt: true } },
      // Nécessaire seulement pour type MEDIA_ALBUM — voir toDetail(), qui en
      // tire un résumé ("📷 3 médias", "🎥 Vidéo"...) sans requête séparée.
      attachments: { select: { type: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;
type MemberWithUser = ConversationWithRelations['members'][number];

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly contacts: ContactsService,
  ) {}

  async createDirect(userId: string, dto: CreateConversationDto) {
    if (dto.userId === userId) {
      throw new BadRequestException('Impossible de démarrer une conversation avec soi-même.');
    }

    const other = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { profile: true },
    });
    if (!other || !other.isActive) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    // Idempotent : une paire d'utilisateurs ne doit avoir qu'une seule
    // conversation directe. `AND` explicite requis (deux conditions
    // existentielles distinctes sur la même relation `members`).
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId, leftAt: null } } },
          { members: { some: { userId: dto.userId, leftAt: null } } },
        ],
      },
      include: CONVERSATION_INCLUDE,
    });
    if (existing) {
      return this.toDetail(existing, userId);
    }

    // "whoCanMessageMe" (section 22/28) : consulté seulement avant de créer
    // une TOUTE NOUVELLE conversation — une conversation déjà établie
    // (`existing` ci-dessus) n'est jamais remise en cause après coup, même
    // si le réglage change ensuite.
    await this.assertCanMessage(userId, other.profile?.whoCanMessageMe ?? 'EVERYONE', dto.userId);

    const created = await this.prisma.conversation.create({
      data: {
        type: 'DIRECT',
        members: { create: [{ userId }, { userId: dto.userId }] },
      },
      include: CONVERSATION_INCLUDE,
    });
    return this.toDetail(created, userId);
  }

  async listMine(userId: string, query: ListConversationsQueryDto = {}) {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });
    if (memberships.length === 0) return { items: [], nextCursor: null };

    const rows = await this.prisma.conversation.findMany({
      where: { id: { in: memberships.map((m) => m.conversationId) } },
      include: CONVERSATION_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: await Promise.all(page.map((conversation) => this.toDetail(conversation, userId))),
      nextCursor,
    };
  }

  async findById(userId: string, conversationId: string) {
    const conversation = await this.loadForMember(userId, conversationId);
    return this.toDetail(conversation, userId);
  }

  async updateMembership(
    userId: string,
    conversationId: string,
    dto: UpdateConversationMembershipDto,
  ) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    // Vérification d'appartenance stricte (section 23) : un utilisateur ne
    // doit jamais pouvoir modifier ses préférences sur une conversation dont
    // il n'est pas (ou plus) membre.
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }

    await this.prisma.conversationMember.update({
      where: { id: membership.id },
      data: dto,
    });

    return this.findById(userId, conversationId);
  }

  /** "whoCanMessageMe" (section 22/28) — jamais consulté pour une conversation déjà existante, voir createDirect. */
  private async assertCanMessage(
    requesterId: string,
    policy: WhoCanInteract,
    targetUserId: string,
  ): Promise<void> {
    if (policy === 'EVERYONE') return;
    if (policy === 'NOBODY') {
      throw new ForbiddenException("Cette personne n'accepte pas de nouveaux messages.");
    }
    // policy === 'CONTACTS'
    const isContact = await this.contacts.areContacts(requesterId, targetUserId);
    if (!isContact) {
      throw new ForbiddenException('Seuls les contacts de cette personne peuvent lui écrire.');
    }
  }

  private async loadForMember(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithRelations> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    const isMember = conversation?.members.some((member) => member.userId === userId) ?? false;
    if (!conversation || !isMember) {
      throw new NotFoundException('Conversation introuvable.');
    }
    return conversation;
  }

  private async toParticipant(member: MemberWithUser) {
    const presence = await this.presence.getPresence(member.user.id);
    return {
      id: member.user.id,
      username: member.user.username,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      avatarUrl: resolveAvatarUrl(member.user.profile, member.user.id),
      statusText: member.user.profile?.statusText ?? null,
      isOnline: presence.isOnline,
      lastSeenAt: presence.lastSeenAt,
    };
  }

  private async toDetail(conversation: ConversationWithRelations, currentUserId: string) {
    const myMembership = conversation.members.find((member) => member.userId === currentUserId);
    if (!myMembership) {
      // Ne devrait jamais arriver : les appelants ne passent ici qu'avec des
      // conversations dont currentUserId est déjà un membre actif.
      throw new NotFoundException('Conversation introuvable.');
    }

    const otherMembers = conversation.members.filter((member) => member.userId !== currentUserId);

    // Requêtes par conversation (N+1 assumé pour ce MVP, comme le compteur de
    // non-lus) : à optimiser en phase 33 (performance) si la liste grossit.
    const [unreadCount, members, otherParticipant] = await Promise.all([
      this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: currentUserId },
          createdAt: { gt: myMembership.lastReadAt ?? new Date(0) },
        },
      }),
      Promise.all(conversation.members.map((member) => this.toParticipant(member))),
      conversation.type === 'DIRECT' && otherMembers[0]
        ? this.toParticipant(otherMembers[0])
        : Promise.resolve(null),
    ]);

    const [lastMessage] = conversation.messages;

    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      otherParticipant,
      members,
      myMembership: {
        isArchived: myMembership.isArchived,
        isMuted: myMembership.isMuted,
        lastReadAt: myMembership.lastReadAt,
      },
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            type: lastMessage.type,
            text: lastMessage.text,
            senderId: lastMessage.senderId,
            sentAt: lastMessage.sentAt,
            // Uniquement renseigné pour type CALL (voir preview() côté
            // frontend) — jamais pour les autres types.
            callType: lastMessage.call?.type ?? null,
            callStatus: lastMessage.call?.status ?? null,
            callDurationSeconds:
              lastMessage.call?.answeredAt && lastMessage.call.endedAt
                ? Math.round(
                    (lastMessage.call.endedAt.getTime() - lastMessage.call.answeredAt.getTime()) /
                      1000,
                  )
                : null,
            // Uniquement renseigné pour type MEDIA_ALBUM — jamais pour les autres types.
            mediaCount: lastMessage.attachments?.length ?? null,
            mediaHasVideo: lastMessage.attachments?.some((a) => a.type === 'VIDEO') ?? null,
          }
        : null,
      unreadCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
