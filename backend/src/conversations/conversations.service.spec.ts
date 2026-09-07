import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Conversation, ConversationMember, Profile, User } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryProvider } from '../uploads/cloudinary.provider';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { ConversationsService } from './conversations.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'honore',
    email: 'honore@example.com',
    phone: null,
    passwordHash: 'hashed',
    firstName: 'Honoré',
    lastName: 'K.',
    primaryLanguageId: 'lang-fr',
    preferredReceiveLanguageId: 'lang-fr',
    isActive: true,
    role: 'USER',
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    avatarUrl: null,
    avatarStorageKey: null,
    avatarStorageProvider: 'LOCAL',
    statusText: null,
    voiceCloningConsent: false,
    voiceCloningUpdatedAt: null,
    voiceModelId: null,
    showLastSeen: true,
    showOnlineStatus: true,
    showReadReceipts: true,
    whoCanMessageMe: 'EVERYONE',
    whoCanSeeMyStatus: 'EVERYONE',
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildMember(overrides: Partial<ConversationMember> = {}): ConversationMember {
  return {
    id: 'member-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    role: 'MEMBER',
    joinedAt: new Date(),
    lastReadAt: null,
    isArchived: false,
    isMuted: false,
    leftAt: null,
    ...overrides,
  };
}

function buildConversation(overrides: Partial<Conversation> = {}) {
  return {
    id: 'conv-1',
    type: 'DIRECT' as const,
    title: null,
    description: null,
    createdById: null,
    photoStorageKey: null,
    photoStorageProvider: 'LOCAL' as const,
    editInfoPermission: 'ADMIN_ONLY' as const,
    sendMessagesPermission: 'EVERYONE' as const,
    addMembersPermission: 'EVERYONE' as const,
    sendMediaPermission: 'EVERYONE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ConversationsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    conversation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    conversationMember: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    message: { count: jest.Mock; create: jest.Mock };
    groupInvite: { findUnique: jest.Mock; create: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let presence: { getPresence: jest.Mock };
  let contacts: { areContacts: jest.Mock; statusWith: jest.Mock };
  let events: { emitToUsers: jest.Mock };
  let notifications: { create: jest.Mock };
  let storage: {
    save: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
    createReadStream: jest.Mock;
  };
  let cloudinary: { isConfigured: jest.Mock; uploadPublic: jest.Mock; delete: jest.Mock };
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      conversationMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      message: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      groupInvite: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    presence = { getPresence: jest.fn().mockResolvedValue({ isOnline: false, lastSeenAt: null }) };
    contacts = {
      areContacts: jest.fn().mockResolvedValue(false),
      statusWith: jest.fn().mockResolvedValue({ status: 'NONE' }),
    };
    events = { emitToUsers: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    storage = {
      save: jest.fn().mockResolvedValue({ key: 'group-photo/generated.jpg', sizeBytes: 123 }),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      createReadStream: jest.fn(),
    };
    cloudinary = {
      isConfigured: jest.fn().mockReturnValue(false),
      uploadPublic: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new ConversationsService(
      prisma as unknown as PrismaService,
      presence as unknown as PresenceService,
      contacts as unknown as ContactsService,
      events as unknown as EventsGateway,
      notifications as unknown as NotificationsService,
      storage as unknown as StorageService,
      cloudinary as unknown as CloudinaryProvider,
    );
  });

  describe('createDirect', () => {
    it('refuse de démarrer une conversation avec soi-même', async () => {
      await expect(service.createDirect('user-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("refuse si l'autre utilisateur n'existe pas ou est désactivé", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createDirect('user-1', { userId: 'user-2' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('est idempotent : renvoie la conversation existante sans en recréer une', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'user-2' }));
      const existingMembers = [
        { ...buildMember({ userId: 'user-1' }), user: { ...buildUser(), profile: buildProfile() } },
        {
          ...buildMember({ id: 'member-2', userId: 'user-2' }),
          user: { ...buildUser({ id: 'user-2' }), profile: buildProfile({ userId: 'user-2' }) },
        },
      ];
      prisma.conversation.findFirst.mockResolvedValue({
        ...buildConversation(),
        members: existingMembers,
        messages: [],
      });

      const result = await service.createDirect('user-1', { userId: 'user-2' });

      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(result.id).toBe('conv-1');
      expect(result.otherParticipant?.id).toBe('user-2');
    });

    it("crée une nouvelle conversation quand aucune n'existe encore", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'user-2' }));
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({
        ...buildConversation(),
        members: [
          {
            ...buildMember({ userId: 'user-1' }),
            user: { ...buildUser(), profile: buildProfile() },
          },
          {
            ...buildMember({ id: 'member-2', userId: 'user-2' }),
            user: { ...buildUser({ id: 'user-2' }), profile: buildProfile({ userId: 'user-2' }) },
          },
        ],
        messages: [],
      });

      const result = await service.createDirect('user-1', { userId: 'user-2' });

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            type: 'DIRECT',
            members: { create: [{ userId: 'user-1' }, { userId: 'user-2' }] },
          }),
        }),
      );
      expect(result.otherParticipant?.id).toBe('user-2');
    });

    it('refuse de créer une nouvelle conversation si "whoCanMessageMe" vaut NOBODY', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...buildUser({ id: 'user-2' }),
        profile: buildProfile({ userId: 'user-2', whoCanMessageMe: 'NOBODY' }),
      });
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(service.createDirect('user-1', { userId: 'user-2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('refuse si "whoCanMessageMe" vaut CONTACTS et que les deux ne sont pas en contact', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...buildUser({ id: 'user-2' }),
        profile: buildProfile({ userId: 'user-2', whoCanMessageMe: 'CONTACTS' }),
      });
      prisma.conversation.findFirst.mockResolvedValue(null);
      contacts.areContacts.mockResolvedValue(false);

      await expect(service.createDirect('user-1', { userId: 'user-2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(contacts.areContacts).toHaveBeenCalledWith('user-1', 'user-2');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('autorise si "whoCanMessageMe" vaut CONTACTS et que les deux SONT en contact', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...buildUser({ id: 'user-2' }),
        profile: buildProfile({ userId: 'user-2', whoCanMessageMe: 'CONTACTS' }),
      });
      prisma.conversation.findFirst.mockResolvedValue(null);
      contacts.areContacts.mockResolvedValue(true);
      prisma.conversation.create.mockResolvedValue({
        ...buildConversation(),
        members: [
          {
            ...buildMember({ userId: 'user-1' }),
            user: { ...buildUser(), profile: buildProfile() },
          },
          {
            ...buildMember({ id: 'member-2', userId: 'user-2' }),
            user: { ...buildUser({ id: 'user-2' }), profile: buildProfile({ userId: 'user-2' }) },
          },
        ],
        messages: [],
      });

      const result = await service.createDirect('user-1', { userId: 'user-2' });

      expect(result.otherParticipant?.id).toBe('user-2');
    });

    it('ne consulte jamais "whoCanMessageMe" pour une conversation déjà existante', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...buildUser({ id: 'user-2' }),
        profile: buildProfile({ userId: 'user-2', whoCanMessageMe: 'NOBODY' }),
      });
      prisma.conversation.findFirst.mockResolvedValue({
        ...buildConversation(),
        members: [
          {
            ...buildMember({ userId: 'user-1' }),
            user: { ...buildUser(), profile: buildProfile() },
          },
          {
            ...buildMember({ id: 'member-2', userId: 'user-2' }),
            user: { ...buildUser({ id: 'user-2' }), profile: buildProfile({ userId: 'user-2' }) },
          },
        ],
        messages: [],
      });

      const result = await service.createDirect('user-1', { userId: 'user-2' });

      expect(result.id).toBe('conv-1');
      expect(contacts.areContacts).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it("refuse l'accès à une conversation dont l'utilisateur n'est pas membre", async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        ...buildConversation(),
        members: [
          {
            ...buildMember({ userId: 'autre-user' }),
            user: { ...buildUser({ id: 'autre-user' }), profile: buildProfile() },
          },
        ],
        messages: [],
      });

      await expect(service.findById('user-1', 'conv-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renvoie 404 (pas 403) pour une conversation inexistante — ne révèle rien', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(service.findById('user-1', 'conv-inconnue')).rejects.toThrow(
        'Conversation introuvable.',
      );
    });
  });

  describe('listMine', () => {
    it("renvoie une liste vide sans interroger les conversations si l'utilisateur n'en a aucune", async () => {
      prisma.conversationMember.findMany.mockResolvedValueOnce([]); // mes memberships

      const result = await service.listMine('user-1');

      expect(result).toEqual({ items: [], nextCursor: null });
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it('pagine par curseur : signale nextCursor quand il reste une page', async () => {
      prisma.conversationMember.findMany.mockResolvedValueOnce([
        { conversationId: 'conv-1' },
        { conversationId: 'conv-2' },
      ]);
      const rows = ['conv-a', 'conv-b', 'conv-c'].map((id) => ({
        ...buildConversation({ id }),
        members: [
          {
            ...buildMember({ userId: 'user-1' }),
            user: { ...buildUser(), profile: buildProfile() },
          },
        ],
        messages: [],
      }));
      prisma.conversation.findMany.mockResolvedValue(rows);

      const result = await service.listMine('user-1', { limit: 2 });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('conv-b');
    });
  });

  describe('updateMembership', () => {
    it("refuse de modifier les préférences d'une conversation dont on n'est plus membre (leftAt)", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMember({ leftAt: new Date() }));

      await expect(
        service.updateMembership('user-1', 'conv-1', { isMuted: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversationMember.update).not.toHaveBeenCalled();
    });
  });

  describe('createGroup', () => {
    function mockCreateGroup(memberIds: string[]) {
      prisma.conversation.create.mockResolvedValue({
        ...buildConversation({ id: 'group-1', type: 'GROUP', title: 'GL3 Algo' }),
      });
      prisma.message.create.mockResolvedValue({
        id: 'sys-1',
        conversationId: 'group-1',
        senderId: 'user-1',
        type: 'SYSTEM',
        systemAction: 'GROUP_CREATED',
        systemTargetUserId: null,
        text: null,
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        sentAt: new Date(),
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        reads: [],
        reactions: [],
        attachments: [],
      });
      prisma.conversation.update.mockResolvedValue({});
      // findById() rechargement final
      prisma.conversation.findUnique.mockResolvedValue({
        ...buildConversation({ id: 'group-1', type: 'GROUP', title: 'GL3 Algo' }),
        members: [
          {
            ...buildMember({ userId: 'user-1', role: 'ADMIN' }),
            user: { ...buildUser(), profile: buildProfile() },
          },
          ...memberIds.map((id) => ({
            ...buildMember({ id: `member-${id}`, userId: id, role: 'MEMBER' as const }),
            user: { ...buildUser({ id }), profile: buildProfile({ userId: id }) },
          })),
        ],
        messages: [],
      });
    }

    it('crée le groupe avec le créateur en ADMIN et les autres en MEMBER', async () => {
      mockCreateGroup(['user-2', 'user-3']);
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'user-2' }));

      await service.createGroup(
        'user-1',
        { title: 'GL3 Algo', memberIds: JSON.stringify(['user-2', 'user-3']) },
        undefined,
      );

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            type: 'GROUP',
            title: 'GL3 Algo',
            createdById: 'user-1',
            members: {
              create: [
                { userId: 'user-1', role: 'ADMIN' },
                { userId: 'user-2', role: 'MEMBER' },
                { userId: 'user-3', role: 'MEMBER' },
              ],
            },
          }),
        }),
      );
      // Message système émis à tous, y compris le créateur.
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ type: 'SYSTEM', systemAction: 'GROUP_CREATED' }),
        }),
      );
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-1', 'user-2', 'user-3'],
        'message:new',
        expect.anything(),
      );
    });

    it('refuse un groupe sans aucun autre membre', async () => {
      await expect(
        service.createGroup('user-1', { title: 'Solo', memberIds: JSON.stringify([]) }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it("refuse un membre initial bloqué (dans un sens ou dans l'autre)", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'user-2' }));
      contacts.statusWith.mockResolvedValue({ status: 'BLOCKED_BY_ME' });

      await expect(
        service.createGroup(
          'user-1',
          { title: 'GL3', memberIds: JSON.stringify(['user-2']) },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });
  });

  describe('permissions de groupe — cas interdits', () => {
    function mockGroup(overrides: { actorRole: 'ADMIN' | 'MEMBER'; adminCount?: number }) {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ id: 'group-1', type: 'GROUP' }),
      );
      prisma.conversationMember.findUnique.mockResolvedValue(
        buildMember({ userId: 'user-1', role: overrides.actorRole }),
      );
      prisma.conversationMember.count.mockResolvedValue(overrides.adminCount ?? 1);
    }

    it('un MEMBER ne peut pas retirer un autre membre (403, jamais 404 — il sait déjà que le groupe existe)', async () => {
      mockGroup({ actorRole: 'MEMBER' });

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.conversationMember.update).not.toHaveBeenCalled();
    });

    it('un MEMBER ne peut pas promouvoir un autre membre administrateur', async () => {
      mockGroup({ actorRole: 'MEMBER' });

      await expect(
        service.setMemberRole('user-1', 'group-1', 'user-2', 'ADMIN'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversationMember.update).not.toHaveBeenCalled();
    });

    it('un MEMBER ne peut pas supprimer le groupe', async () => {
      mockGroup({ actorRole: 'MEMBER' });

      await expect(service.deleteGroup('user-1', 'group-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.conversation.delete).not.toHaveBeenCalled();
    });

    it('un ADMIN peut supprimer le groupe', async () => {
      mockGroup({ actorRole: 'ADMIN' });
      prisma.conversationMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      prisma.conversation.delete.mockResolvedValue({});

      await service.deleteGroup('user-1', 'group-1');

      expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'group-1' } });
      expect(events.emitToUsers).toHaveBeenCalledWith(['user-1', 'user-2'], 'conversation:left', {
        conversationId: 'group-1',
      });
    });

    it('refuse de retirer/rétrograder le dernier administrateur du groupe', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ id: 'group-1', type: 'GROUP' }),
      );
      // L'appelant (ADMIN) agit sur user-2, qui est l'AUTRE administrateur —
      // mais c'est le dernier (adminCount des AUTRES admins = 0).
      prisma.conversationMember.findUnique.mockImplementation(
        ({ where }: { where: { conversationId_userId: { userId: string } } }) => {
          const targetUserId = where.conversationId_userId.userId;
          return Promise.resolve(
            buildMember({
              userId: targetUserId,
              role: targetUserId === 'user-1' ? 'ADMIN' : 'ADMIN',
            }),
          );
        },
      );
      prisma.conversationMember.count.mockResolvedValue(0); // aucun AUTRE administrateur

      await expect(
        service.setMemberRole('user-1', 'group-1', 'user-2', 'MEMBER'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversationMember.update).not.toHaveBeenCalled();
    });
  });

  describe("Lien d'invitation", () => {
    beforeEach(() => {
      // Forme complète (avec members/messages) : couvre à la fois
      // loadGroupForAction (n'a besoin que des colonnes scalaires) et le
      // findById() final de joinViaInvite (a besoin de members/messages,
      // voir CONVERSATION_INCLUDE).
      prisma.conversation.findUnique.mockResolvedValue({
        ...buildConversation({ id: 'group-1', type: 'GROUP' }),
        members: [
          {
            ...buildMember({ userId: 'user-2' }),
            user: { ...buildUser({ id: 'user-2' }), profile: buildProfile({ userId: 'user-2' }) },
          },
        ],
        messages: [],
      });
    });

    it("un MEMBER ne peut pas créer/gérer le lien d'invitation", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(
        buildMember({ userId: 'user-1', role: 'MEMBER' }),
      );

      await expect(service.getOrCreateInvite('user-1', 'group-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.groupInvite.create).not.toHaveBeenCalled();
    });

    it('un ADMIN crée un lien la première fois, puis renvoie le même ensuite (idempotent)', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(
        buildMember({ userId: 'user-1', role: 'ADMIN' }),
      );
      prisma.groupInvite.findUnique.mockResolvedValue(null);
      prisma.groupInvite.create.mockResolvedValue({ token: 'abc123', isActive: true });

      const result = await service.getOrCreateInvite('user-1', 'group-1');

      expect(result).toEqual({ token: 'abc123', isActive: true });
      expect(prisma.groupInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ conversationId: 'group-1', createdById: 'user-1' }),
        }),
      );
    });

    it('resetInvite régénère le token (jamais le même deux fois)', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(
        buildMember({ userId: 'user-1', role: 'ADMIN' }),
      );
      prisma.groupInvite.upsert.mockImplementation(({ update }: { update: { token: string } }) =>
        Promise.resolve({ token: update.token, isActive: true }),
      );

      const result = await service.resetInvite('user-1', 'group-1');

      expect(result.token).toBeTruthy();
      expect(prisma.groupInvite.upsert).toHaveBeenCalled();
    });

    it('previewInvite refuse un lien désactivé', async () => {
      prisma.groupInvite.findUnique.mockResolvedValue({ isActive: false });

      await expect(service.previewInvite('token-inactif')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('previewInvite refuse un token inconnu', async () => {
      prisma.groupInvite.findUnique.mockResolvedValue(null);

      await expect(service.previewInvite('token-inconnu')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('joinViaInvite ajoute le membre et crée un message système', async () => {
      prisma.groupInvite.findUnique.mockResolvedValue({
        conversationId: 'group-1',
        isActive: true,
      });
      prisma.conversationMember.findUnique.mockResolvedValue(null); // pas encore membre
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      prisma.message.create.mockResolvedValue({ reads: [] });

      await service.joinViaInvite('user-2', 'abc123');

      expect(prisma.conversationMember.create).toHaveBeenCalledWith({
        data: { conversationId: 'group-1', userId: 'user-2', role: 'MEMBER' },
      });
      expect(events.emitToUsers).toHaveBeenCalledWith(
        expect.arrayContaining(['user-2']),
        'message:new',
        expect.anything(),
      );
    });

    it('joinViaInvite est idempotent si déjà membre actif', async () => {
      prisma.groupInvite.findUnique.mockResolvedValue({
        conversationId: 'group-1',
        isActive: true,
      });
      prisma.conversationMember.findUnique.mockResolvedValue(
        buildMember({ userId: 'user-2', leftAt: null }),
      );

      await service.joinViaInvite('user-2', 'abc123');

      expect(prisma.conversationMember.create).not.toHaveBeenCalled();
    });

    it('joinViaInvite refuse un lien désactivé', async () => {
      prisma.groupInvite.findUnique.mockResolvedValue({
        conversationId: 'group-1',
        isActive: false,
      });

      await expect(service.joinViaInvite('user-2', 'abc123')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.conversationMember.create).not.toHaveBeenCalled();
    });
  });
});
