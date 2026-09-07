import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ContactRequest } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUserDto, UsersService } from '../users/users.service';
import { EventsGateway } from '../websocket/events.gateway';
import { ContactsService } from './contacts.service';

function buildRequest(overrides: Partial<ContactRequest> = {}): ContactRequest {
  return {
    id: 'req-1',
    requesterId: 'alice',
    recipientId: 'bob',
    status: 'PENDING',
    blockedById: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

function buildPublicProfile(overrides: Partial<PublicUserDto> = {}): PublicUserDto {
  return {
    id: 'bob',
    username: 'bob',
    firstName: 'Bob',
    lastName: 'Martin',
    avatarUrl: null,
    statusText: null,
    isOnline: false,
    lastSeenAt: null,
    primaryLanguage: null,
    spokenLanguages: [],
    ...overrides,
  };
}

describe('ContactsService', () => {
  let prisma: {
    contactRequest: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    conversationMember: { findUnique: jest.Mock; findMany: jest.Mock };
    message: { create: jest.Mock; findUnique: jest.Mock };
    conversation: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let users: { getPublicProfile: jest.Mock };
  let notifications: { create: jest.Mock };
  let events: { emitToUsers: jest.Mock };
  let service: ContactsService;

  beforeEach(() => {
    prisma = {
      contactRequest: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      conversationMember: { findUnique: jest.fn(), findMany: jest.fn() },
      message: { create: jest.fn(), findUnique: jest.fn() },
      conversation: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    users = { getPublicProfile: jest.fn().mockResolvedValue(buildPublicProfile()) };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    events = { emitToUsers: jest.fn() };
    service = new ContactsService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      notifications as unknown as NotificationsService,
      events as unknown as EventsGateway,
    );
  });

  describe('sendRequest', () => {
    it('refuse de se demander soi-même en contact', async () => {
      await expect(service.sendRequest('alice', 'alice')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.contactRequest.create).not.toHaveBeenCalled();
    });

    it('404 si le destinataire est introuvable ou inactif (relayé par UsersService)', async () => {
      users.getPublicProfile.mockRejectedValue(new NotFoundException());
      await expect(service.sendRequest('alice', 'bob')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crée une demande PENDING et notifie le destinataire quand aucune relation n’existe', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(null);
      prisma.contactRequest.create.mockResolvedValue(buildRequest());

      const result = await service.sendRequest('alice', 'bob');

      expect(prisma.contactRequest.create).toHaveBeenCalledWith({
        data: { requesterId: 'alice', recipientId: 'bob', status: 'PENDING' },
      });
      expect(notifications.create).toHaveBeenCalledWith('bob', 'CONTACT_REQUEST', {
        userId: 'alice',
      });
      expect(result.status).toBe('PENDING');
    });

    it('accepte automatiquement si le destinataire avait déjà envoyé une demande PENDING dans l’autre sens', async () => {
      // reverse = requesterId: bob, recipientId: alice (le premier findUnique appelé)
      prisma.contactRequest.findUnique.mockResolvedValueOnce(
        buildRequest({ id: 'req-reverse', requesterId: 'bob', recipientId: 'alice' }),
      );
      prisma.contactRequest.update.mockResolvedValue(
        buildRequest({
          id: 'req-reverse',
          requesterId: 'bob',
          recipientId: 'alice',
          status: 'ACCEPTED',
        }),
      );

      const result = await service.sendRequest('alice', 'bob');

      expect(prisma.contactRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-reverse' },
        data: { status: 'ACCEPTED' },
      });
      expect(notifications.create).toHaveBeenCalledWith('bob', 'CONTACT_ACCEPTED', {
        userId: 'alice',
      });
      expect(prisma.contactRequest.create).not.toHaveBeenCalled();
      expect(result.status).toBe('ACCEPTED');
    });

    it('refuse si déjà en contact (sens direct)', async () => {
      prisma.contactRequest.findUnique
        .mockResolvedValueOnce(null) // reverse
        .mockResolvedValueOnce(buildRequest({ status: 'ACCEPTED' })); // direct

      await expect(service.sendRequest('alice', 'bob')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse si une demande PENDING existe déjà dans le même sens', async () => {
      prisma.contactRequest.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildRequest({ status: 'PENDING' }));

      await expect(service.sendRequest('alice', 'bob')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse si bloqué par l’autre, avec un message distinct si on est soi-même l’auteur du blocage', async () => {
      prisma.contactRequest.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildRequest({ status: 'BLOCKED', blockedById: 'bob' }));
      await expect(service.sendRequest('alice', 'bob')).rejects.toBeInstanceOf(ForbiddenException);

      prisma.contactRequest.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildRequest({ status: 'BLOCKED', blockedById: 'alice' }));
      await expect(service.sendRequest('alice', 'bob')).rejects.toThrow(
        'Débloquez cette personne avant de lui envoyer une demande.',
      );
    });

    it('relance une demande DECLINED en repassant à PENDING plutôt que d’en dupliquer une', async () => {
      prisma.contactRequest.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildRequest({ status: 'DECLINED' }));
      prisma.contactRequest.update.mockResolvedValue(buildRequest({ status: 'PENDING' }));

      const result = await service.sendRequest('alice', 'bob');

      expect(prisma.contactRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'PENDING', blockedById: null },
      });
      expect(prisma.contactRequest.create).not.toHaveBeenCalled();
      expect(result.status).toBe('PENDING');
    });
  });

  describe('accept', () => {
    it('404 si la demande est introuvable', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(null);
      await expect(service.accept('bob', 'req-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse si l’utilisateur n’est pas le destinataire', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      await expect(service.accept('carol', 'req-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuse si la demande n’est plus PENDING', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest({ status: 'ACCEPTED' }));
      await expect(service.accept('bob', 'req-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepte, notifie le demandeur d’origine et renvoie son profil public', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      prisma.contactRequest.update.mockResolvedValue(buildRequest({ status: 'ACCEPTED' }));

      const result = await service.accept('bob', 'req-1');

      expect(notifications.create).toHaveBeenCalledWith('alice', 'CONTACT_ACCEPTED', {
        userId: 'bob',
      });
      expect(users.getPublicProfile).toHaveBeenCalledWith('alice');
      expect(result.status).toBe('ACCEPTED');
    });
  });

  describe('decline', () => {
    it('refuse si l’utilisateur n’est pas le destinataire', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      await expect(service.decline('carol', 'req-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passe la demande à DECLINED sans notifier', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      await service.decline('bob', 'req-1');

      expect(prisma.contactRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'DECLINED' },
      });
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('refuse si l’utilisateur n’est pas l’auteur de la demande', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      await expect(service.cancel('bob', 'req-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('supprime la demande PENDING', async () => {
      prisma.contactRequest.findUnique.mockResolvedValue(buildRequest());
      await service.cancel('alice', 'req-1');
      expect(prisma.contactRequest.delete).toHaveBeenCalledWith({ where: { id: 'req-1' } });
    });
  });

  describe('block / unblock', () => {
    it('refuse de se bloquer soi-même', async () => {
      await expect(service.block('alice', 'alice')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('crée une ligne BLOCKED quand aucune relation n’existait', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(null);
      await service.block('alice', 'bob');
      expect(prisma.contactRequest.create).toHaveBeenCalledWith({
        data: { requesterId: 'alice', recipientId: 'bob', status: 'BLOCKED', blockedById: 'alice' },
      });
    });

    it('met à jour une relation existante (quel que soit son sens) vers BLOCKED', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(
        buildRequest({ id: 'req-x', status: 'ACCEPTED' }),
      );
      await service.block('alice', 'bob');
      expect(prisma.contactRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-x' },
        data: { status: 'BLOCKED', blockedById: 'alice' },
      });
    });

    it('refuse de débloquer si ce n’est pas soi qui a bloqué', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(
        buildRequest({ status: 'BLOCKED', blockedById: 'bob' }),
      );
      await expect(service.unblock('alice', 'bob')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('supprime la ligne au déblocage par son auteur', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(
        buildRequest({ id: 'req-x', status: 'BLOCKED', blockedById: 'alice' }),
      );
      await service.unblock('alice', 'bob');
      expect(prisma.contactRequest.delete).toHaveBeenCalledWith({ where: { id: 'req-x' } });
    });
  });

  describe('statusWith', () => {
    it('NONE si aucune relation', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(null);
      await expect(service.statusWith('alice', 'bob')).resolves.toEqual({ status: 'NONE' });
    });

    it('distingue PENDING_SENT et PENDING_RECEIVED selon le sens', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(buildRequest({ status: 'PENDING' }));
      await expect(service.statusWith('alice', 'bob')).resolves.toEqual({
        status: 'PENDING_SENT',
      });
      await expect(service.statusWith('bob', 'alice')).resolves.toEqual({
        status: 'PENDING_RECEIVED',
      });
    });

    it('distingue BLOCKED_BY_ME et BLOCKED_BY_THEM', async () => {
      prisma.contactRequest.findFirst.mockResolvedValue(
        buildRequest({ status: 'BLOCKED', blockedById: 'alice' }),
      );
      await expect(service.statusWith('alice', 'bob')).resolves.toEqual({
        status: 'BLOCKED_BY_ME',
      });
      await expect(service.statusWith('bob', 'alice')).resolves.toEqual({
        status: 'BLOCKED_BY_THEM',
      });
    });
  });

  describe('shareContact', () => {
    it('refuse de partager sa propre carte', async () => {
      await expect(
        service.shareContact('alice', { conversationId: 'conv-1', userId: 'alice' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 si l’expéditeur n’est pas membre de la conversation', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);
      await expect(
        service.shareContact('alice', { conversationId: 'conv-1', userId: 'bob' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crée le message CONTACT_SHARE, émet message:new et notifie les autres membres', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue({ leftAt: null });
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'carol' }]);
      const createdMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'alice',
        sentAt: new Date('2026-01-01T10:00:00Z'),
        createdAt: new Date('2026-01-01T10:00:00Z'),
      };
      prisma.$transaction.mockResolvedValue([createdMessage, {}]);
      users.getPublicProfile.mockResolvedValue(
        buildPublicProfile({ id: 'bob', firstName: 'Bob', lastName: 'Martin' }),
      );

      const result = await service.shareContact('alice', {
        conversationId: 'conv-1',
        userId: 'bob',
      });

      expect(result.type).toBe('CONTACT_SHARE');
      expect(result.sharedContact).toEqual(
        expect.objectContaining({ id: 'bob', firstName: 'Bob' }),
      );
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['carol'],
        'message:new',
        expect.objectContaining({ id: 'msg-1', type: 'CONTACT_SHARE' }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        'carol',
        'NEW_MESSAGE',
        expect.objectContaining({ conversationId: 'conv-1', messageId: 'msg-1' }),
      );
    });

    it('renvoie toujours reactions/mentions/mentionsEveryone (jamais absents) — un message CONTACT_SHARE sans ces champs fait planter le rendu de la bulle côté frontend (MessageBubble.tsx, "Cannot read properties of undefined")', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue({ leftAt: null });
      prisma.conversationMember.findMany.mockResolvedValue([]);
      prisma.$transaction.mockResolvedValue([
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'alice',
          sentAt: new Date(),
          createdAt: new Date(),
        },
        {},
      ]);
      users.getPublicProfile.mockResolvedValue(buildPublicProfile({ id: 'bob' }));

      const result = await service.shareContact('alice', { conversationId: 'conv-1', userId: 'bob' });

      expect(result).toEqual(
        expect.objectContaining({ reactions: [], mentions: [], mentionsEveryone: false }),
      );
    });
  });

  describe('getByMessageId', () => {
    it('404 si le message n’est pas un CONTACT_SHARE', async () => {
      prisma.message.findUnique.mockResolvedValue({ type: 'TEXT', sharedContact: null });
      await expect(service.getByMessageId('alice', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 si l’utilisateur n’est pas membre de la conversation', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        type: 'CONTACT_SHARE',
        conversationId: 'conv-1',
        senderId: 'alice',
        sentAt: new Date(),
        createdAt: new Date(),
        sharedContact: { sharedUserId: 'bob' },
      });
      prisma.conversationMember.findUnique.mockResolvedValue(null);
      await expect(service.getByMessageId('carol', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('renvoie la carte de contact hydratée', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        type: 'CONTACT_SHARE',
        conversationId: 'conv-1',
        senderId: 'alice',
        sentAt: new Date(),
        createdAt: new Date(),
        sharedContact: { sharedUserId: 'bob' },
      });
      prisma.conversationMember.findUnique.mockResolvedValue({ userId: 'carol' });

      const result = await service.getByMessageId('carol', 'msg-1');
      expect(result.sharedContact.id).toBe('bob');
      // Chemin emprunté à chaque ouverture d'une conversation contenant un
      // CONTACT_SHARE historique (hydrateContactShareMessages côté
      // frontend) — mêmes champs requis que shareContact() ci-dessus.
      expect(result).toEqual(
        expect.objectContaining({ reactions: [], mentions: [], mentionsEveryone: false }),
      );
    });
  });
});
