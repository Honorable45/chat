import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Conversation,
  ConversationMember,
  GroupPermission,
  GroupRole,
  Prisma,
  WhoCanInteract,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ContactsService } from '../contacts/contacts.service';
import { MESSAGE_INCLUDE, toMessageDto } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from '../uploads/media-upload.constants';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { matchesFileSignature } from '../uploads/file-signature.util';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { AddMembersDto } from './dto/add-members.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { UpdateConversationMembershipDto } from './dto/update-conversation-membership.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { resolveGroupPhotoUrl } from './group-photo.util';

const DEFAULT_PAGE_SIZE = 30;

/** Actions système reconnues par le frontend pour reconstruire le texte dans la langue du lecteur (voir Message.systemAction). */
export type GroupSystemAction =
  | 'GROUP_CREATED'
  | 'MEMBER_ADDED'
  | 'MEMBER_REMOVED'
  | 'MEMBER_LEFT'
  | 'MEMBER_PROMOTED'
  | 'MEMBER_DEMOTED'
  | 'GROUP_RENAMED'
  | 'GROUP_PHOTO_CHANGED'
  | 'GROUP_DESCRIPTION_CHANGED'
  | 'MEMBER_JOINED_VIA_LINK';

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
    private readonly events: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly cloudinary: CloudinaryProvider,
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
      // Sans effet pour une conversation DIRECT (toujours MEMBER, jamais affiché).
      role: member.role,
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
      // Champs de groupe — toujours null/par défaut pour une conversation
      // DIRECT (jamais renseignés dans ce cas, voir le schéma).
      description: conversation.description,
      photoUrl: resolveGroupPhotoUrl(conversation, conversation.id),
      createdById: conversation.createdById,
      editInfoPermission: conversation.editInfoPermission,
      sendMessagesPermission: conversation.sendMessagesPermission,
      addMembersPermission: conversation.addMembersPermission,
      sendMediaPermission: conversation.sendMediaPermission,
      mentionEveryonePermission: conversation.mentionEveryonePermission,
      otherParticipant,
      members,
      myMembership: {
        isArchived: myMembership.isArchived,
        isMuted: myMembership.isMuted,
        lastReadAt: myMembership.lastReadAt,
        role: myMembership.role,
      },
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            type: lastMessage.type,
            text: lastMessage.text,
            senderId: lastMessage.senderId,
            sentAt: lastMessage.sentAt,
            // Uniquement renseignés pour type SYSTEM — jamais pour les autres types.
            systemAction: lastMessage.systemAction,
            systemTargetUserId: lastMessage.systemTargetUserId,
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

  // -------------------------------------------------------------------------
  // Groupes
  // -------------------------------------------------------------------------

  /**
   * Crée un groupe : le créateur devient automatiquement ADMIN (section 5),
   * les membres initiaux MEMBER. Rejette tout ID bloqué (dans un sens ou
   * l'autre — section 21) ou inexistant, plutôt que de créer un groupe
   * incomplet en silence.
   */
  async createGroup(
    userId: string,
    dto: CreateGroupDto,
    photoFile: Express.Multer.File | undefined,
  ) {
    const memberIds = this.parseUserIdArray(dto.memberIds);
    const uniqueMemberIds = [...new Set(memberIds)].filter((id) => id !== userId);
    if (uniqueMemberIds.length === 0) {
      throw new BadRequestException('Un groupe doit avoir au moins un autre membre.');
    }

    for (const memberId of uniqueMemberIds) {
      await this.assertCanAddToGroup(userId, memberId);
    }

    const photo = photoFile ? await this.saveGroupPhoto(photoFile) : null;

    const conversation = await this.prisma.conversation.create({
      data: {
        type: 'GROUP',
        title: dto.title,
        description: dto.description,
        createdById: userId,
        photoStorageKey: photo?.key ?? null,
        photoStorageProvider: photo?.provider ?? 'LOCAL',
        members: {
          create: [
            { userId, role: 'ADMIN' },
            ...uniqueMemberIds.map((id) => ({ userId: id, role: 'MEMBER' as const })),
          ],
        },
      },
    });

    await this.createSystemMessage(conversation.id, userId, 'GROUP_CREATED', null, [
      userId,
      ...uniqueMemberIds,
    ]);

    await Promise.all(
      uniqueMemberIds.map((memberId) =>
        this.notifications.create(memberId, 'ADDED_TO_GROUP', {
          conversationId: conversation.id,
          actorId: userId,
        }),
      ),
    );

    return this.findById(userId, conversation.id);
  }

  /**
   * Modifie nom/description/photo/permissions — les permissions ne peuvent
   * être changées que par un ADMIN, quel que soit editInfoPermission (un
   * réglage qui ne gouverne que le nom/description/photo, jamais qui a le
   * droit de le modifier lui-même).
   */
  async updateGroup(
    userId: string,
    conversationId: string,
    dto: UpdateGroupDto,
    photoFile: Express.Multer.File | undefined,
  ) {
    const { conversation, membership } = await this.loadGroupForAction(userId, conversationId);

    const changingPermissions =
      dto.editInfoPermission !== undefined ||
      dto.sendMessagesPermission !== undefined ||
      dto.addMembersPermission !== undefined ||
      dto.sendMediaPermission !== undefined ||
      dto.mentionEveryonePermission !== undefined;
    if (changingPermissions && membership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Seuls les administrateurs peuvent modifier les permissions du groupe.',
      );
    }
    const changingInfo =
      dto.title !== undefined || dto.description !== undefined || Boolean(photoFile);
    if (changingInfo) {
      this.assertPermission(
        membership,
        conversation.editInfoPermission,
        'modifier les informations du groupe',
      );
    }

    const data: Prisma.ConversationUpdateInput = {};
    const systemActions: GroupSystemAction[] = [];

    if (dto.title !== undefined && dto.title !== conversation.title) {
      data.title = dto.title;
      systemActions.push('GROUP_RENAMED');
    }
    if (dto.description !== undefined && dto.description !== conversation.description) {
      data.description = dto.description;
      systemActions.push('GROUP_DESCRIPTION_CHANGED');
    }
    if (dto.editInfoPermission !== undefined) data.editInfoPermission = dto.editInfoPermission;
    if (dto.sendMessagesPermission !== undefined)
      data.sendMessagesPermission = dto.sendMessagesPermission;
    if (dto.addMembersPermission !== undefined)
      data.addMembersPermission = dto.addMembersPermission;
    if (dto.sendMediaPermission !== undefined) data.sendMediaPermission = dto.sendMediaPermission;
    if (dto.mentionEveryonePermission !== undefined)
      data.mentionEveryonePermission = dto.mentionEveryonePermission;

    if (photoFile) {
      const photo = await this.saveGroupPhoto(photoFile);
      if (conversation.photoStorageKey) {
        await this.deleteGroupPhotoFile(
          conversation.photoStorageKey,
          conversation.photoStorageProvider,
        );
      }
      data.photoStorageKey = photo.key;
      data.photoStorageProvider = photo.provider;
      systemActions.push('GROUP_PHOTO_CHANGED');
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data });
    }

    if (systemActions.length > 0) {
      const recipients = await this.allMemberIds(conversationId);
      for (const action of systemActions) {
        await this.createSystemMessage(conversationId, userId, action, null, recipients);
      }
    }

    return this.findById(userId, conversationId);
  }

  /** Ajoute un ou plusieurs membres — chaque cible invalide (déjà membre, bloquée, inexistante) est silencieusement ignorée plutôt que de faire échouer tout le lot. */
  async addMembers(userId: string, conversationId: string, dto: AddMembersDto) {
    const { conversation, membership } = await this.loadGroupForAction(userId, conversationId);
    this.assertPermission(membership, conversation.addMembersPermission, 'ajouter des membres');

    const uniqueIds = [...new Set(dto.userIds)].filter((id) => id !== userId);
    const existingMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { in: uniqueIds } },
    });
    const existingByUserId = new Map(existingMembers.map((m) => [m.userId, m]));

    const toAdd: string[] = [];
    for (const targetId of uniqueIds) {
      const existing = existingByUserId.get(targetId);
      if (existing && !existing.leftAt) continue; // déjà membre actif
      try {
        await this.assertCanAddToGroup(userId, targetId);
      } catch {
        continue; // bloqué ou inexistant : ignoré, jamais une erreur qui bloquerait tout le lot
      }
      toAdd.push(targetId);
    }
    if (toAdd.length === 0) {
      throw new BadRequestException("Aucun des utilisateurs sélectionnés n'a pu être ajouté.");
    }

    await this.prisma.$transaction(
      toAdd.map((targetId) => {
        const existing = existingByUserId.get(targetId);
        return existing
          ? this.prisma.conversationMember.update({
              where: { id: existing.id },
              data: { leftAt: null, role: 'MEMBER', joinedAt: new Date() },
            })
          : this.prisma.conversationMember.create({
              data: { conversationId, userId: targetId, role: 'MEMBER' },
            });
      }),
    );

    const recipients = await this.allMemberIds(conversationId);
    for (const targetId of toAdd) {
      await this.createSystemMessage(conversationId, userId, 'MEMBER_ADDED', targetId, recipients);
      await this.notifications.create(targetId, 'ADDED_TO_GROUP', {
        conversationId,
        actorId: userId,
      });
    }

    return this.findById(userId, conversationId);
  }

  /** Retire un membre — ADMIN uniquement (jamais soi-même, voir leaveGroup). */
  async removeMember(userId: string, conversationId: string, targetUserId: string): Promise<void> {
    const { membership: actorMembership } = await this.loadGroupForAction(userId, conversationId);
    if (actorMembership.role !== 'ADMIN') {
      throw new ForbiddenException('Seuls les administrateurs peuvent retirer un membre.');
    }
    if (targetUserId === userId) {
      throw new BadRequestException('Utilisez "Quitter le groupe" pour vous retirer vous-même.');
    }
    await this.assertNotLastAdmin(conversationId, targetUserId);

    const target = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });
    if (!target || target.leftAt) {
      throw new NotFoundException('Ce membre ne fait pas partie du groupe.');
    }

    const recipientsBeforeRemoval = await this.allMemberIds(conversationId);
    await this.prisma.conversationMember.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });

    await this.createSystemMessage(
      conversationId,
      userId,
      'MEMBER_REMOVED',
      targetUserId,
      recipientsBeforeRemoval,
    );
    await this.notifications.create(targetUserId, 'REMOVED_FROM_GROUP', {
      conversationId,
      actorId: userId,
    });
    this.events.emitToUsers([targetUserId], 'conversation:left', { conversationId });
  }

  /** L'utilisateur quitte lui-même le groupe. */
  async leaveGroup(userId: string, conversationId: string): Promise<void> {
    const { membership } = await this.loadGroupForAction(userId, conversationId);
    await this.assertNotLastAdmin(conversationId, userId);

    const recipientsBeforeLeaving = await this.allMemberIds(conversationId);
    await this.prisma.conversationMember.update({
      where: { id: membership.id },
      data: { leftAt: new Date() },
    });

    await this.createSystemMessage(
      conversationId,
      userId,
      'MEMBER_LEFT',
      null,
      recipientsBeforeLeaving.filter((id) => id !== userId),
    );
    this.events.emitToUsers([userId], 'conversation:left', { conversationId });
  }

  /** Promotion/rétrogradation — ADMIN uniquement. */
  async setMemberRole(
    userId: string,
    conversationId: string,
    targetUserId: string,
    role: GroupRole,
  ) {
    const { membership: actorMembership } = await this.loadGroupForAction(userId, conversationId);
    if (actorMembership.role !== 'ADMIN') {
      throw new ForbiddenException('Seuls les administrateurs peuvent gérer les rôles.');
    }
    if (role === 'MEMBER') {
      await this.assertNotLastAdmin(conversationId, targetUserId);
    }

    const target = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });
    if (!target || target.leftAt) {
      throw new NotFoundException('Ce membre ne fait pas partie du groupe.');
    }
    if (target.role === role) {
      return this.findById(userId, conversationId); // déjà ce rôle : idempotent
    }

    await this.prisma.conversationMember.update({ where: { id: target.id }, data: { role } });

    const recipients = await this.allMemberIds(conversationId);
    await this.createSystemMessage(
      conversationId,
      userId,
      role === 'ADMIN' ? 'MEMBER_PROMOTED' : 'MEMBER_DEMOTED',
      targetUserId,
      recipients,
    );
    if (role === 'ADMIN') {
      await this.notifications.create(targetUserId, 'PROMOTED_ADMIN', {
        conversationId,
        actorId: userId,
      });
    }

    return this.findById(userId, conversationId);
  }

  /** Supprime définitivement le groupe — ADMIN uniquement. Suppression physique (cascade Prisma sur membres/messages), pas de corbeille. */
  async deleteGroup(userId: string, conversationId: string): Promise<void> {
    const { conversation, membership } = await this.loadGroupForAction(userId, conversationId);
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException('Seuls les administrateurs peuvent supprimer le groupe.');
    }

    const recipients = await this.allMemberIds(conversationId);
    if (conversation.photoStorageKey) {
      await this.deleteGroupPhotoFile(
        conversation.photoStorageKey,
        conversation.photoStorageProvider,
      );
    }
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    this.events.emitToUsers(recipients, 'conversation:left', { conversationId });
  }

  /** Réservé aux membres actifs du groupe — même contrainte qu'un avatar/une pièce jointe LOCAL. */
  async streamGroupPhoto(userId: string, conversationId: string) {
    await this.assertGroupMembership(userId, conversationId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation?.photoStorageKey) {
      throw new NotFoundException('Photo introuvable.');
    }
    if (conversation.photoStorageProvider !== 'LOCAL') {
      throw new NotFoundException('Cette photo ne se sert plus par cette route.');
    }
    if (!(await this.storage.exists(conversation.photoStorageKey))) {
      throw new NotFoundException('Fichier introuvable.');
    }
    return {
      stream: this.storage.createReadStream(conversation.photoStorageKey),
      mimeType: 'image/jpeg',
    };
  }

  // -------------------------------------------------------------------------
  // Lien d'invitation (section 7)
  // -------------------------------------------------------------------------

  private generateInviteToken(): string {
    // ~12 caractères, URL-safe — suffisamment imprévisible pour un lien
    // partagé (pas un secret de session, mais jamais devinable par force
    // brute raisonnable).
    return randomBytes(9).toString('base64url');
  }

  /** Renvoie le lien actif du groupe, en crée un s'il n'existe pas encore — ADMIN uniquement. */
  async getOrCreateInvite(
    userId: string,
    conversationId: string,
  ): Promise<{ token: string; isActive: boolean }> {
    const { membership } = await this.loadGroupForAction(userId, conversationId);
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException("Seuls les administrateurs peuvent gérer le lien d'invitation.");
    }
    const existing = await this.prisma.groupInvite.findUnique({ where: { conversationId } });
    if (existing) return { token: existing.token, isActive: existing.isActive };
    const created = await this.prisma.groupInvite.create({
      data: { conversationId, token: this.generateInviteToken(), createdById: userId },
    });
    return { token: created.token, isActive: created.isActive };
  }

  /** Régénère le token — invalide instantanément l'ancien lien (section 7 : "Réinitialiser"). ADMIN uniquement. */
  async resetInvite(
    userId: string,
    conversationId: string,
  ): Promise<{ token: string; isActive: boolean }> {
    const { membership } = await this.loadGroupForAction(userId, conversationId);
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException("Seuls les administrateurs peuvent gérer le lien d'invitation.");
    }
    const token = this.generateInviteToken();
    const updated = await this.prisma.groupInvite.upsert({
      where: { conversationId },
      update: { token, isActive: true },
      create: { conversationId, token, createdById: userId },
    });
    return { token: updated.token, isActive: updated.isActive };
  }

  /** Active/désactive le lien sans le régénérer (section 7). ADMIN uniquement. */
  async setInviteActive(
    userId: string,
    conversationId: string,
    isActive: boolean,
  ): Promise<{ token: string; isActive: boolean }> {
    const { membership } = await this.loadGroupForAction(userId, conversationId);
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException("Seuls les administrateurs peuvent gérer le lien d'invitation.");
    }
    const existing = await this.prisma.groupInvite.findUnique({ where: { conversationId } });
    if (!existing) {
      const created = await this.prisma.groupInvite.create({
        data: { conversationId, token: this.generateInviteToken(), createdById: userId, isActive },
      });
      return { token: created.token, isActive: created.isActive };
    }
    const updated = await this.prisma.groupInvite.update({
      where: { conversationId },
      data: { isActive },
    });
    return { token: updated.token, isActive: updated.isActive };
  }

  /**
   * Public — aucune authentification (section 7 : aperçu avant de rejoindre).
   * Uniquement les informations déjà publiques d'un groupe (jamais membres/
   * permissions/messages). Limitation connue : si la photo du groupe est
   * stockée en LOCAL (Cloudinary non configuré), son URL pointe vers une
   * route protégée par appartenance et ne s'affichera donc pas pour ce
   * visiteur non-membre — sans conséquence une fois Cloudinary configuré
   * (URL publique dans ce cas), acceptable en attendant pour ce cas limite.
   */
  async previewInvite(token: string) {
    const invite = await this.prisma.groupInvite.findUnique({
      where: { token },
      include: { conversation: { include: { members: { where: { leftAt: null } } } } },
    });
    if (!invite || !invite.isActive) {
      throw new NotFoundException("Ce lien d'invitation est invalide ou n'est plus actif.");
    }
    return {
      title: invite.conversation.title,
      description: invite.conversation.description,
      photoUrl: resolveGroupPhotoUrl(invite.conversation, invite.conversationId),
      memberCount: invite.conversation.members.length,
    };
  }

  /** Rejoint le groupe via un lien d'invitation actif — idempotent si déjà membre. */
  async joinViaInvite(userId: string, token: string) {
    const invite = await this.prisma.groupInvite.findUnique({ where: { token } });
    if (!invite || !invite.isActive) {
      throw new NotFoundException("Ce lien d'invitation est invalide ou n'est plus actif.");
    }

    const existingMembership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: invite.conversationId, userId } },
    });
    if (existingMembership && !existingMembership.leftAt) {
      return this.findById(userId, invite.conversationId); // déjà membre : idempotent
    }

    if (existingMembership) {
      await this.prisma.conversationMember.update({
        where: { id: existingMembership.id },
        data: { leftAt: null, role: 'MEMBER', joinedAt: new Date() },
      });
    } else {
      await this.prisma.conversationMember.create({
        data: { conversationId: invite.conversationId, userId, role: 'MEMBER' },
      });
    }

    const recipients = await this.allMemberIds(invite.conversationId);
    await this.createSystemMessage(
      invite.conversationId,
      userId,
      'MEMBER_JOINED_VIA_LINK',
      null,
      recipients,
    );

    return this.findById(userId, invite.conversationId);
  }

  private parseUserIdArray(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  /** Rejette un ID inexistant/inactif ou bloqué dans un sens ou l'autre (section 21) — jamais d'ajout silencieux d'un utilisateur qui ne devrait pas se retrouver dans ce groupe. */
  private async assertCanAddToGroup(actorId: string, targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || !target.isActive) {
      throw new BadRequestException('Utilisateur introuvable.');
    }
    const { status } = await this.contacts.statusWith(actorId, targetUserId);
    if (status === 'BLOCKED_BY_ME' || status === 'BLOCKED_BY_THEM') {
      throw new BadRequestException("Impossible d'ajouter un utilisateur bloqué au groupe.");
    }
  }

  /** Membre actif d'une conversation, groupe ou non — 404 pour ne rien révéler à un non-membre (section 23/25). */
  private async assertGroupMembership(
    userId: string,
    conversationId: string,
  ): Promise<ConversationMember> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }
    return membership;
  }

  /** Charge un groupe (jamais une conversation DIRECT) et vérifie l'appartenance active de l'appelant. */
  private async loadGroupForAction(
    userId: string,
    conversationId: string,
  ): Promise<{
    conversation: Conversation;
    membership: ConversationMember;
  }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('Groupe introuvable.');
    }
    const membership = await this.assertGroupMembership(userId, conversationId);
    return { conversation, membership };
  }

  /**
   * Un membre déjà confirmé (loadGroupForAction) qui tente une action
   * ADMIN_ONLY sans être ADMIN reçoit un 403, jamais un 404 — il sait déjà
   * que ce groupe existe, contrairement au non-membre visé par la
   * convention 404 (section 25).
   */
  private assertPermission(
    membership: { role: GroupRole },
    permission: GroupPermission,
    action: string,
  ): void {
    if (permission === 'ADMIN_ONLY' && membership.role !== 'ADMIN') {
      throw new ForbiddenException(`Seuls les administrateurs peuvent ${action}.`);
    }
  }

  /** Un groupe ne doit jamais se retrouver sans administrateur (retrait/rétrogradation/départ du dernier). */
  private async assertNotLastAdmin(conversationId: string, targetUserId: string): Promise<void> {
    const target = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });
    if (!target || target.role !== 'ADMIN' || target.leftAt) return;

    const otherAdminCount = await this.prisma.conversationMember.count({
      where: { conversationId, role: 'ADMIN', leftAt: null, userId: { not: targetUserId } },
    });
    if (otherAdminCount === 0) {
      throw new BadRequestException(
        "Le groupe doit garder au moins un administrateur — promouvez quelqu'un d'autre avant de continuer.",
      );
    }
  }

  private async allMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** Crée le message système et le diffuse en temps réel — même mécanisme qu'un message normal (voir MessagesService.send), réutilisé tel quel. */
  private async createSystemMessage(
    conversationId: string,
    actorId: string,
    systemAction: GroupSystemAction,
    systemTargetUserId: string | null,
    recipientIds: string[],
  ): Promise<void> {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: actorId,
          type: 'SYSTEM',
          systemAction,
          systemTargetUserId,
        },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    this.events.emitToUsers(recipientIds, 'message:new', toMessageDto(message, this.cloudinary));
  }

  /** Même séquence exacte que ProfilesService.setAvatar — Cloudinary public si configuré, disque local sinon. */
  private async saveGroupPhoto(
    file: Express.Multer.File,
  ): Promise<{ key: string; provider: 'LOCAL' | 'CLOUDINARY' }> {
    if (!file || file.size === 0) {
      throw new BadRequestException('Aucune image reçue.');
    }
    const extension = ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Format d'image non supporté : "${file.mimetype}". Formats acceptés : ${Object.keys(ALLOWED_IMAGE_MIME_TYPES).join(', ')}.`,
      );
    }
    if (!matchesFileSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        `Le contenu du fichier ne correspond pas au format déclaré ("${file.mimetype}").`,
      );
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException(
        `L'image est trop volumineuse (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
          MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
        } Mo).`,
      );
    }
    return this.cloudinary.isConfigured()
      ? await this.cloudinary
          .uploadPublic(file.buffer, 'group-photo')
          .then((uploaded) => ({ key: uploaded.publicId, provider: 'CLOUDINARY' as const }))
      : await this.storage
          .save(file.buffer, 'group-photo', extension)
          .then((stored) => ({ key: stored.key, provider: 'LOCAL' as const }));
  }

  private async deleteGroupPhotoFile(key: string, provider: 'LOCAL' | 'CLOUDINARY'): Promise<void> {
    if (provider === 'CLOUDINARY') {
      await this.cloudinary.delete(key, 'image', 'upload');
    } else {
      await this.storage.delete(key);
    }
  }
}
