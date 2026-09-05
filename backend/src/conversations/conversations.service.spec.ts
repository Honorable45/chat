import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Conversation, ConversationMember, Profile, User } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
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
      findMany: jest.Mock;
    };
    conversationMember: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    message: { count: jest.Mock };
  };
  let presence: { getPresence: jest.Mock };
  let contacts: { areContacts: jest.Mock };
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      conversationMember: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      message: { count: jest.fn().mockResolvedValue(0) },
    };
    presence = { getPresence: jest.fn().mockResolvedValue({ isOnline: false, lastSeenAt: null }) };
    contacts = { areContacts: jest.fn().mockResolvedValue(false) };
    service = new ConversationsService(
      prisma as unknown as PrismaService,
      presence as unknown as PresenceService,
      contacts as unknown as ContactsService,
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
});
