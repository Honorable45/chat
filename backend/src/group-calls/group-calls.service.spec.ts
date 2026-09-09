import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupCallsService } from './group-calls.service';

const MESSAGE_STUB = {
  id: 'message-1',
  conversationId: 'conv-1',
  senderId: 'alice',
  sentAt: new Date('2026-01-01T10:00:00Z'),
  createdAt: new Date('2026-01-01T10:00:00Z'),
};

function buildParticipantRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'alice',
    status: 'JOINED',
    user: {
      firstName: 'Alice',
      lastName: 'Dupont',
      profile: { avatarUrl: null, avatarStorageKey: null, avatarStorageProvider: 'LOCAL' },
    },
    ...overrides,
  };
}

function buildCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    conversationId: 'conv-1',
    messageId: 'message-1',
    initiatorId: 'alice',
    type: 'AUDIO',
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T10:00:00Z'),
    endedAt: null,
    participants: [
      buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
      buildParticipantRow({ userId: 'bob', status: 'RINGING' }),
    ],
    ...overrides,
  };
}

describe('GroupCallsService', () => {
  let prisma: {
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    groupCall: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    groupCallParticipant: { upsert: jest.Mock; update: jest.Mock };
    message: { create: jest.Mock; findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    conversationMember: { findUnique: jest.Mock };
  };
  let notifications: { create: jest.Mock };
  let service: GroupCallsService;

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      groupCall: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      groupCallParticipant: { upsert: jest.fn(), update: jest.fn() },
      message: { create: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      conversationMember: { findUnique: jest.fn() },
    };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    service = new GroupCallsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('start', () => {
    const conversation = {
      id: 'conv-1',
      type: 'GROUP',
      members: [{ userId: 'alice' }, { userId: 'bob' }, { userId: 'carol' }],
    };

    it("refuse pour une conversation DIRECT (jamais d'appel de groupe hors GROUP)", async () => {
      prisma.conversation.findUnique.mockResolvedValue({ ...conversation, type: 'DIRECT' });
      await expect(service.start('alice', 'conv-1', 'AUDIO')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si l'appelant n'est pas membre", async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      await expect(service.start('mallory', 'conv-1', 'AUDIO')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('crée le message GROUP_CALL, invite tous les autres membres en RINGING, et notifie chacun', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.groupCall.findFirst.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue({
        ...MESSAGE_STUB,
        groupCall: buildCall({
          participants: [
            buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
            buildParticipantRow({ userId: 'bob', status: 'RINGING' }),
            buildParticipantRow({ userId: 'carol', status: 'RINGING' }),
          ],
        }),
      });

      const result = await service.start('alice', 'conv-1', 'AUDIO');

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'GROUP_CALL',
            groupCall: {
              create: expect.objectContaining({
                initiatorId: 'alice',
                participants: {
                  create: [
                    { userId: 'alice', status: 'JOINED', joinedAt: expect.any(Date) },
                    { userId: 'bob', status: 'RINGING' },
                    { userId: 'carol', status: 'RINGING' },
                  ],
                },
              }),
            },
          }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith('bob', 'INCOMING_CALL', expect.any(Object));
      expect(notifications.create).toHaveBeenCalledWith(
        'carol',
        'INCOMING_CALL',
        expect.any(Object),
      );
      expect(notifications.create).not.toHaveBeenCalledWith(
        'alice',
        expect.anything(),
        expect.anything(),
      );
      expect(result.groupCall.participants).toHaveLength(3);
    });

    it("rejoint l'appel déjà actif de la conversation plutôt que d'en créer un second", async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      const existing = buildCall();
      prisma.groupCall.findFirst.mockResolvedValue(existing);
      prisma.message.findUniqueOrThrow.mockResolvedValue({
        ...MESSAGE_STUB,
        groupCall: buildCall({
          participants: [
            buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
            buildParticipantRow({ userId: 'carol', status: 'JOINED' }),
          ],
        }),
      });

      await service.start('carol', 'conv-1', 'AUDIO');

      expect(prisma.groupCallParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupCallId_userId: { groupCallId: 'call-1', userId: 'carol' } },
          update: expect.objectContaining({ status: 'JOINED' }),
        }),
      );
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('startFromEscalation', () => {
    it("crée le message GROUP_CALL avec les deux participants d'origine déjà JOINED et l'invité en RINGING, sans vérifier ni le type ni le membership de la conversation", async () => {
      prisma.message.create.mockResolvedValue({
        ...MESSAGE_STUB,
        groupCall: buildCall({
          participants: [
            buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
            buildParticipantRow({ userId: 'bob', status: 'JOINED' }),
            buildParticipantRow({ userId: 'carol', status: 'RINGING' }),
          ],
        }),
      });

      const result = await service.startFromEscalation(
        'alice',
        'conv-1',
        'AUDIO',
        ['alice', 'bob'],
        'carol',
      );

      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            senderId: 'alice',
            type: 'GROUP_CALL',
            groupCall: {
              create: expect.objectContaining({
                initiatorId: 'alice',
                participants: {
                  create: [
                    { userId: 'alice', status: 'JOINED', joinedAt: expect.any(Date) },
                    { userId: 'bob', status: 'JOINED', joinedAt: expect.any(Date) },
                    { userId: 'carol', status: 'RINGING' },
                  ],
                },
              }),
            },
          }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        'carol',
        'INCOMING_CALL',
        expect.any(Object),
      );
      expect(notifications.create).not.toHaveBeenCalledWith(
        'alice',
        expect.anything(),
        expect.anything(),
      );
      expect(notifications.create).not.toHaveBeenCalledWith(
        'bob',
        expect.anything(),
        expect.anything(),
      );
      expect(result.groupCall.participants).toHaveLength(3);
    });
  });

  describe('invite', () => {
    it("refuse si l'appelant n'est pas lui-même JOINED", async () => {
      prisma.groupCall.findUnique.mockResolvedValue(buildCall());
      await expect(service.invite('bob', 'call-1', ['carol'])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("refuse si l'appel n'est plus actif", async () => {
      prisma.groupCall.findUnique.mockResolvedValue(buildCall({ status: 'ENDED' }));
      await expect(service.invite('alice', 'call-1', ['carol'])).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('invite les nouveaux membres en RINGING et notifie chacun, ignore les membres déjà JOINED', async () => {
      prisma.groupCall.findUnique.mockResolvedValue(buildCall());
      prisma.conversation.findUnique.mockResolvedValue({
        members: [{ userId: 'alice' }, { userId: 'bob' }, { userId: 'carol' }],
      });
      prisma.message.findUniqueOrThrow.mockResolvedValue(MESSAGE_STUB);

      await service.invite('alice', 'call-1', ['alice', 'carol']);

      expect(prisma.groupCallParticipant.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.groupCallParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupCallId_userId: { groupCallId: 'call-1', userId: 'carol' } },
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        'carol',
        'INCOMING_CALL',
        expect.any(Object),
      );
      expect(notifications.create).not.toHaveBeenCalledWith(
        'alice',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('join', () => {
    it("refuse si l'utilisateur n'a jamais été invité", async () => {
      prisma.groupCall.findUnique.mockResolvedValue(buildCall());
      await expect(service.join('mallory', 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passe le participant à JOINED et renvoie les autres userId déjà JOINED', async () => {
      prisma.groupCall.findUnique.mockResolvedValueOnce(buildCall()).mockResolvedValueOnce(
        buildCall({
          participants: [
            buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
            buildParticipantRow({ userId: 'bob', status: 'JOINED' }),
          ],
        }),
      );

      const result = await service.join('bob', 'call-1');

      expect(prisma.groupCallParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupCallId_userId: { groupCallId: 'call-1', userId: 'bob' } },
          data: expect.objectContaining({ status: 'JOINED' }),
        }),
      );
      expect(result.peerUserIds).toEqual(['alice']);
    });
  });

  describe('decline', () => {
    it('passe le participant à DECLINED', async () => {
      prisma.groupCall.findUnique
        .mockResolvedValueOnce(buildCall())
        .mockResolvedValueOnce(
          buildCall({ participants: [buildParticipantRow({ userId: 'bob', status: 'DECLINED' })] }),
        );

      await service.decline('bob', 'call-1');

      expect(prisma.groupCallParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DECLINED' } }),
      );
    });
  });

  describe('leave', () => {
    it("termine l'appel entier s'il ne reste plus qu'un participant JOINED", async () => {
      prisma.groupCall.findUnique
        .mockResolvedValueOnce(
          buildCall({
            participants: [
              buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
              buildParticipantRow({ userId: 'bob', status: 'JOINED' }),
            ],
          }),
        )
        .mockResolvedValueOnce(buildCall({ status: 'ENDED' }));

      await service.leave('bob', 'call-1');

      expect(prisma.groupCall.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ENDED' }) }),
      );
    });

    it("ne termine pas l'appel s'il reste au moins deux participants JOINED après le départ", async () => {
      prisma.groupCall.findUnique
        .mockResolvedValueOnce(
          buildCall({
            participants: [
              buildParticipantRow({ userId: 'alice', status: 'JOINED' }),
              buildParticipantRow({ userId: 'bob', status: 'JOINED' }),
              buildParticipantRow({ userId: 'carol', status: 'JOINED' }),
            ],
          }),
        )
        .mockResolvedValueOnce(buildCall());

      await service.leave('carol', 'call-1');

      expect(prisma.groupCall.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveOrphaned', () => {
    it("fait quitter l'utilisateur déconnecté de chaque appel de groupe actif où il est JOINED", async () => {
      prisma.groupCall.findMany.mockResolvedValue([{ id: 'call-1' }, { id: 'call-2' }]);
      prisma.groupCall.findUnique
        .mockResolvedValueOnce(buildCall({ id: 'call-1' }))
        .mockResolvedValueOnce(buildCall({ id: 'call-1' }))
        .mockResolvedValueOnce(buildCall({ id: 'call-2' }))
        .mockResolvedValueOnce(buildCall({ id: 'call-2' }));

      const resolved = await service.resolveOrphaned('bob');

      expect(resolved).toHaveLength(2);
    });
  });

  describe('getByMessageId', () => {
    it('404 si le message ne porte aucun appel de groupe', async () => {
      prisma.message.findUnique.mockResolvedValue({ ...MESSAGE_STUB, groupCall: null });
      await expect(service.getByMessageId('alice', 'message-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404 si l'appelant n'est pas membre de la conversation (jamais 403)", async () => {
      prisma.message.findUnique.mockResolvedValue({ ...MESSAGE_STUB, groupCall: buildCall() });
      prisma.conversationMember.findUnique.mockResolvedValue(null);
      await expect(service.getByMessageId('mallory', 'message-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getParticipantUserIds', () => {
    it('renvoie uniquement les userId JOINED', async () => {
      prisma.groupCall.findUnique.mockResolvedValue({
        participants: [{ userId: 'alice' }, { userId: 'bob' }],
      });

      const result = await service.getParticipantUserIds('call-1');

      expect(result).toEqual(new Set(['alice', 'bob']));
    });

    it('renvoie null si l’appel est introuvable', async () => {
      prisma.groupCall.findUnique.mockResolvedValue(null);
      const result = await service.getParticipantUserIds('call-inconnu');
      expect(result).toBeNull();
    });
  });
});
