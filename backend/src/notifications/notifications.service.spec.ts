import { NotFoundException } from '@nestjs/common';
import type { Notification, Profile } from '@prisma/client';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from './notifications.service';

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

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'NEW_MESSAGE',
    payload: {},
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let prisma: {
    profile: { findUnique: jest.Mock };
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let events: { emitToUser: jest.Mock };
  let presence: { isViewingConversation: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      profile: { findUnique: jest.fn().mockResolvedValue(buildProfile()) },
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
    };
    events = { emitToUser: jest.fn() };
    presence = { isViewingConversation: jest.fn().mockReturnValue(false) };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsGateway,
      presence as unknown as PresenceService,
    );
  });

  describe('create', () => {
    it('ne crée rien si le destinataire a désactivé les notifications', async () => {
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ notificationsEnabled: false }));

      const result = await service.create('user-1', 'NEW_MESSAGE', { conversationId: 'conv-1' });

      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(events.emitToUser).not.toHaveBeenCalled();
    });

    it('crée la notification et la diffuse en temps réel sinon', async () => {
      const notification = buildNotification();
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create('user-1', 'NEW_MESSAGE', { conversationId: 'conv-1' });

      expect(result?.id).toBe('notif-1');
      expect(events.emitToUser).toHaveBeenCalledWith(
        'user-1',
        'notification:new',
        expect.objectContaining({ id: 'notif-1' }),
      );
    });

    it('ne crée rien pour un type "message" si le destinataire a déjà cette conversation ouverte', async () => {
      presence.isViewingConversation.mockReturnValue(true);

      const result = await service.create('user-1', 'NEW_MESSAGE', { conversationId: 'conv-1' });

      expect(result).toBeNull();
      expect(presence.isViewingConversation).toHaveBeenCalledWith('user-1', 'conv-1');
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(events.emitToUser).not.toHaveBeenCalled();
    });

    it('supprime aussi NEW_VOICE_MESSAGE et REACTION quand la conversation est ouverte', async () => {
      presence.isViewingConversation.mockReturnValue(true);

      await expect(
        service.create('user-1', 'NEW_VOICE_MESSAGE', { conversationId: 'conv-1' }),
      ).resolves.toBeNull();
      await expect(
        service.create('user-1', 'REACTION', { conversationId: 'conv-1' }),
      ).resolves.toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('crée quand même la notification si un autre appareil du même utilisateur regarde une AUTRE conversation', async () => {
      presence.isViewingConversation.mockReturnValue(false); // conv-1, pas conv-2
      const notification = buildNotification();
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create('user-1', 'NEW_MESSAGE', { conversationId: 'conv-1' });

      expect(result).not.toBeNull();
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('ne supprime jamais un appel entrant/manqué même si la conversation est ouverte (sonnerie distincte)', async () => {
      presence.isViewingConversation.mockReturnValue(true);
      prisma.notification.create.mockResolvedValue(buildNotification({ type: 'INCOMING_CALL' }));

      const result = await service.create('user-1', 'INCOMING_CALL', { conversationId: 'conv-1' });

      expect(result).not.toBeNull();
      expect(prisma.notification.create).toHaveBeenCalled();
      // Le filtre "conversation ouverte" ne s'applique jamais aux appels — jamais consulté pour ce type.
      expect(presence.isViewingConversation).not.toHaveBeenCalled();
    });

    it('ne supprime jamais CONTACT_REQUEST/CONTACT_ACCEPTED (jamais liés à une conversation ouverte)', async () => {
      presence.isViewingConversation.mockReturnValue(true);
      prisma.notification.create.mockResolvedValue(buildNotification({ type: 'CONTACT_REQUEST' }));

      const result = await service.create('user-1', 'CONTACT_REQUEST', { userId: 'other-user' });

      expect(result).not.toBeNull();
      expect(prisma.notification.create).toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it("refuse de marquer lue la notification d'un autre utilisateur", async () => {
      prisma.notification.findUnique.mockResolvedValue(buildNotification({ userId: 'autre-user' }));

      await expect(service.markRead('user-1', 'notif-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('est idempotent : ne réécrit pas une notification déjà lue', async () => {
      prisma.notification.findUnique.mockResolvedValue(buildNotification({ readAt: new Date() }));

      await service.markRead('user-1', 'notif-1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('marque lue et horodate readAt', async () => {
      prisma.notification.findUnique.mockResolvedValue(buildNotification());
      prisma.notification.update.mockResolvedValue(buildNotification({ readAt: new Date() }));

      const result = await service.markRead('user-1', 'notif-1');

      expect(result.readAt).not.toBeNull();
    });
  });

  describe('markAllRead', () => {
    it('renvoie le nombre de notifications marquées lues', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead('user-1');

      expect(result).toEqual({ count: 3 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', readAt: null } }),
      );
    });
  });
});
