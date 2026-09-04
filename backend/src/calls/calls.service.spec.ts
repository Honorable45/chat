import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Call } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';

function buildCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    messageId: 'message-1',
    callerId: 'alice',
    calleeId: 'bob',
    type: 'AUDIO',
    status: 'RINGING',
    startedAt: new Date('2026-01-01T10:00:00Z'),
    answeredAt: null,
    endedAt: null,
    ...overrides,
  };
}

const MESSAGE_STUB = {
  conversationId: 'conv-1',
  senderId: 'alice',
  sentAt: new Date('2026-01-01T10:00:00Z'),
  createdAt: new Date('2026-01-01T10:00:00Z'),
};

describe('CallsService', () => {
  let prisma: {
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    call: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    message: { create: jest.Mock };
    conversationMember: { findUnique: jest.Mock };
  };
  let notifications: { create: jest.Mock };
  let service: CallsService;

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      call: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      message: { create: jest.fn() },
      conversationMember: { findUnique: jest.fn() },
    };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    service = new CallsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('invite', () => {
    const conversation = {
      id: 'conv-1',
      type: 'DIRECT',
      members: [{ userId: 'alice' }, { userId: 'bob' }],
    };

    it("refuse de s'appeler soi-même", async () => {
      await expect(service.invite('alice', 'conv-1', 'alice')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('404 si la conversation est introuvable, de groupe, ou que le destinataire n’en est pas membre', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce(null);
      await expect(service.invite('alice', 'conv-1', 'bob')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.conversation.findUnique.mockResolvedValueOnce({ ...conversation, type: 'GROUP' });
      await expect(service.invite('alice', 'conv-1', 'bob')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.conversation.findUnique.mockResolvedValueOnce({
        ...conversation,
        members: [{ userId: 'alice' }],
      });
      await expect(service.invite('alice', 'conv-1', 'bob')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("renvoie { busy: true } sans rien écrire si l'appelé participe déjà à un appel", async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.call.findFirst.mockResolvedValue(buildCall({ id: 'other-call' }));

      const result = await service.invite('alice', 'conv-1', 'bob');

      expect(result).toEqual({ busy: true });
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('crée le message CALL + l’appel imbriqué, fait remonter la conversation et notifie l’appelé', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.call.findFirst.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue({
        id: 'message-1',
        sentAt: MESSAGE_STUB.sentAt,
        createdAt: MESSAGE_STUB.createdAt,
        call: buildCall(),
      });

      const result = await service.invite('alice', 'conv-1', 'bob');

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // Les matchers Jest imbriqués (`expect.objectContaining` dans un
          // objet littéral) sont typés `any` dans @types/jest — sans danger
          // ici, c'est un assert de test, pas du code applicatif.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            conversationId: 'conv-1',
            senderId: 'alice',
            type: 'CALL',
            call: {
              create: { callerId: 'alice', calleeId: 'bob', type: 'AUDIO', status: 'RINGING' },
            },
          }),
        }),
      );
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Date) est typé `any`, assert de test uniquement.
        data: { updatedAt: expect.any(Date) },
      });
      expect(notifications.create).toHaveBeenCalledWith('bob', 'INCOMING_CALL', {
        conversationId: 'conv-1',
        messageId: 'message-1',
        callId: 'call-1',
        callerId: 'alice',
      });
      expect(result).not.toHaveProperty('busy');
      if (!('busy' in result)) {
        expect(result.call.status).toBe('RINGING');
        expect(result.senderId).toBe('alice');
      }
    });

    it('démarre un appel vidéo quand demandé explicitement (par défaut : AUDIO)', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.call.findFirst.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue({
        id: 'message-1',
        sentAt: MESSAGE_STUB.sentAt,
        createdAt: MESSAGE_STUB.createdAt,
        call: buildCall({ type: 'VIDEO' }),
      });

      await service.invite('alice', 'conv-1', 'bob', 'VIDEO');

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            call: {
              create: { callerId: 'alice', calleeId: 'bob', type: 'VIDEO', status: 'RINGING' },
            },
          }),
        }),
      );
    });
  });

  describe('accept / reject', () => {
    it("refuse si l'appel ne concerne pas l'appelant du refus/acceptation (mauvais destinataire)", async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall());
      await expect(service.accept('mallory', 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.reject('mallory', 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuse si l'appel n'est plus en sonnerie", async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall({ status: 'ACTIVE' }));
      await expect(service.accept('bob', 'call-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepte : passe ACTIVE et notifie l’appelant via le retour', async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall());
      prisma.call.update.mockResolvedValue({
        ...buildCall({ status: 'ACTIVE', answeredAt: new Date() }),
        message: MESSAGE_STUB,
      });

      const result = await service.accept('bob', 'call-1');

      expect(prisma.call.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'call-1' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Date) est typé `any`, assert de test uniquement.
          data: { status: 'ACTIVE', answeredAt: expect.any(Date) },
        }),
      );
      expect(result.call.status).toBe('ACTIVE');
    });

    it('refuse : passe DECLINED', async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall());
      prisma.call.update.mockResolvedValue({
        ...buildCall({ status: 'DECLINED', endedAt: new Date() }),
        message: MESSAGE_STUB,
      });

      const result = await service.reject('bob', 'call-1');

      expect(result.call.status).toBe('DECLINED');
      expect(notifications.create).not.toHaveBeenCalled(); // pas de notification MISSED_CALL pour un refus explicite
    });
  });

  describe('cancel', () => {
    it("refuse si l'appelant n'est pas à l'origine de l'appel", async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall());
      await expect(service.cancel('bob', 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passe MISSED et notifie MISSED_CALL à l’appelé', async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall());
      prisma.call.update.mockResolvedValue({
        ...buildCall({ status: 'MISSED', endedAt: new Date() }),
        message: MESSAGE_STUB,
      });

      const result = await service.cancel('alice', 'call-1');

      expect(result.call.status).toBe('MISSED');
      expect(notifications.create).toHaveBeenCalledWith('bob', 'MISSED_CALL', {
        conversationId: 'conv-1',
        messageId: 'message-1',
        callId: 'call-1',
        callerId: 'alice',
      });
    });
  });

  describe('end', () => {
    it("refuse si l'utilisateur ne participe pas à l'appel", async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall({ status: 'ACTIVE' }));
      await expect(service.end('mallory', 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuse si l'appel n'est pas en cours", async () => {
      prisma.call.findUnique.mockResolvedValue(buildCall({ status: 'RINGING' }));
      await expect(service.end('alice', 'call-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('calcule la durée à partir de answeredAt/endedAt', async () => {
      const answeredAt = new Date('2026-01-01T10:00:00Z');
      const endedAt = new Date('2026-01-01T10:02:15Z');
      prisma.call.findUnique.mockResolvedValue(buildCall({ status: 'ACTIVE', answeredAt }));
      prisma.call.update.mockResolvedValue({
        ...buildCall({ status: 'ENDED', answeredAt, endedAt }),
        message: MESSAGE_STUB,
      });

      const result = await service.end('bob', 'call-1');

      expect(result.call.durationSeconds).toBe(135);
    });
  });

  describe('resolveOrphaned', () => {
    it('marque MISSED un appel encore en sonnerie et notifie l’appelé, ENDED un appel actif sans notification', async () => {
      const ringing = buildCall({ id: 'ringing', status: 'RINGING' });
      const active = buildCall({ id: 'active', status: 'ACTIVE' });
      prisma.call.findMany.mockResolvedValue([ringing, active]);
      prisma.call.update
        .mockResolvedValueOnce({ ...ringing, status: 'MISSED', message: MESSAGE_STUB })
        .mockResolvedValueOnce({ ...active, status: 'ENDED', message: MESSAGE_STUB });

      const resolved = await service.resolveOrphaned('alice');

      expect(resolved).toHaveLength(2);
      expect(resolved[0].call.status).toBe('MISSED');
      expect(resolved[1].call.status).toBe('ENDED');
      // Une seule notification MISSED_CALL (pour l'appel RINGING), aucune pour l'appel ACTIVE.
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith('bob', 'MISSED_CALL', expect.any(Object));
    });
  });

  describe('listForUser', () => {
    function buildParticipant(overrides: Record<string, unknown> = {}) {
      return {
        id: 'bob',
        firstName: 'Bob',
        lastName: 'Martin',
        profile: { avatarUrl: null, avatarStorageKey: null },
        ...overrides,
      };
    }

    it('résout la direction (sortant/entrant) et l’autre participant du point de vue de l’appelant', async () => {
      prisma.call.findMany.mockResolvedValue([
        {
          ...buildCall({
            answeredAt: new Date('2026-01-01T10:00:00Z'),
            endedAt: new Date('2026-01-01T10:01:30Z'),
            status: 'ENDED',
          }),
          message: { conversationId: 'conv-1' },
          caller: buildParticipant({ id: 'alice', firstName: 'Alice', lastName: 'Dupont' }),
          callee: buildParticipant({ id: 'bob', firstName: 'Bob', lastName: 'Martin' }),
        },
      ]);

      const { items, nextCursor } = await service.listForUser('alice');

      expect(nextCursor).toBeNull();
      expect(items).toEqual([
        expect.objectContaining({
          direction: 'outgoing',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining imbriqué est typé `any`, assert de test uniquement.
          otherUser: expect.objectContaining({ id: 'bob' }),
          durationSeconds: 90,
        }),
      ]);
    });

    it('inverse la direction et l’autre participant du point de vue de l’appelé', async () => {
      prisma.call.findMany.mockResolvedValue([
        {
          ...buildCall(),
          message: { conversationId: 'conv-1' },
          caller: buildParticipant({ id: 'alice', firstName: 'Alice', lastName: 'Dupont' }),
          callee: buildParticipant({ id: 'bob', firstName: 'Bob', lastName: 'Martin' }),
        },
      ]);

      const { items } = await service.listForUser('bob');

      expect(items[0]).toEqual(
        expect.objectContaining({
          direction: 'incoming',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining imbriqué est typé `any`, assert de test uniquement.
          otherUser: expect.objectContaining({ id: 'alice' }),
        }),
      );
    });
  });

  describe('iceServers', () => {
    const originalEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('renvoie le STUN Google et le TURN Open Relay par défaut si rien n’est configuré', () => {
      delete process.env.STUN_URLS;
      delete process.env.TURN_URLS;
      delete process.env.TURN_USERNAME;
      delete process.env.TURN_CREDENTIAL;

      const servers = service.iceServers();

      expect(servers[0]).toEqual({ urls: ['stun:stun.l.google.com:19302'] });
      expect(servers[1]).toMatchObject({
        username: 'openrelayproject',
        credential: 'openrelayproject',
      });
    });

    it('respecte une configuration TURN explicite', () => {
      process.env.TURN_URLS = 'turn:example.com:3478';
      process.env.TURN_USERNAME = 'me';
      process.env.TURN_CREDENTIAL = 'secret';

      const servers = service.iceServers();

      expect(servers[1]).toEqual({
        urls: ['turn:example.com:3478'],
        username: 'me',
        credential: 'secret',
      });
    });
  });
});
