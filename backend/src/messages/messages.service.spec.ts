import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConversationMember, Message } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { MessagesService } from './messages.service';

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    type: 'TEXT',
    text: 'Bonjour',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    sentAt: new Date(),
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildImageFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'image',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 2000,
    buffer: Buffer.alloc(2000, 1),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

function buildMembership(overrides: Partial<ConversationMember> = {}): ConversationMember {
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

describe('MessagesService', () => {
  let prisma: {
    message: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    conversation: { update: jest.Mock };
    conversationMember: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    messageRead: { createMany: jest.Mock };
    attachment: { findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let events: { emitToUsers: jest.Mock };
  let presence: { isOnline: jest.Mock };
  let notifications: { create: jest.Mock };
  let storage: {
    save: jest.Mock;
    exists: jest.Mock;
    createReadStream: jest.Mock;
    delete: jest.Mock;
  };
  let service: MessagesService;

  beforeEach(() => {
    prisma = {
      message: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      conversation: { update: jest.fn() },
      conversationMember: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      messageRead: { createMany: jest.fn() },
      attachment: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    events = { emitToUsers: jest.fn() };
    presence = { isOnline: jest.fn().mockReturnValue(false) };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    storage = {
      save: jest.fn().mockResolvedValue({ key: 'attachment/generated.jpg', sizeBytes: 123 }),
      exists: jest.fn().mockResolvedValue(true),
      createReadStream: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new MessagesService(
      prisma as unknown as PrismaService,
      events as unknown as EventsGateway,
      presence as unknown as PresenceService,
      notifications as unknown as NotificationsService,
      storage as unknown as StorageService,
    );
  });

  describe('send', () => {
    it("refuse d'envoyer dans une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.send('user-1', { conversationId: 'conv-1', text: 'salut' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuse une réponse à un message situé dans une autre conversation', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.message.findUnique.mockResolvedValue(
        buildMessage({ id: 'msg-autre', conversationId: 'conv-2' }),
      );

      await expect(
        service.send('user-1', { conversationId: 'conv-1', text: 'salut', replyToId: 'msg-autre' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marque le message livré immédiatement si le destinataire est en ligne', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      presence.isOnline.mockReturnValue(true);
      const created = buildMessage({ deliveredAt: new Date() });
      prisma.$transaction.mockResolvedValue([{ ...created, reads: [] }, {}]);

      const result = await service.send('user-1', { conversationId: 'conv-1', text: 'salut' });

      expect(result.deliveredAt).not.toBeNull();
    });

    it("laisse deliveredAt à null si aucun destinataire n'est en ligne", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      presence.isOnline.mockReturnValue(false);
      prisma.$transaction.mockResolvedValue([{ ...buildMessage(), reads: [] }, {}]);

      const result = await service.send('user-1', { conversationId: 'conv-1', text: 'salut' });

      expect(result.deliveredAt).toBeNull();
    });

    it('crée le message, fait remonter la conversation et notifie les autres membres', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      const created = { ...buildMessage({ text: 'salut' }), reads: [] };
      prisma.$transaction.mockResolvedValue([created, {}]);

      const result = await service.send('user-1', { conversationId: 'conv-1', text: 'salut' });

      expect(result.text).toBe('salut');
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2'],
        'message:new',
        expect.objectContaining({ id: created.id }),
      );
    });
  });

  describe('sendImage', () => {
    it("refuse si aucun fichier n'est fourni", async () => {
      await expect(
        service.sendImage('user-1', { conversationId: 'conv-1' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse un type MIME non supporté', async () => {
      await expect(
        service.sendImage(
          'user-1',
          { conversationId: 'conv-1' },
          buildImageFile({ mimetype: 'image/tiff' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un fichier trop volumineux', async () => {
      await expect(
        service.sendImage(
          'user-1',
          { conversationId: 'conv-1' },
          buildImageFile({ size: 9 * 1024 * 1024 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("refuse d'envoyer dans une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.sendImage('user-1', { conversationId: 'conv-1' }, buildImageFile()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('stocke le fichier, crée le message IMAGE et notifie les autres membres', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      const created = {
        ...buildMessage({ type: 'IMAGE', text: 'une légende' }),
        reads: [],
        attachments: [
          {
            id: 'att-1',
            mimeType: 'image/jpeg',
            sizeBytes: 123,
            type: 'IMAGE',
            fileName: null,
            durationSeconds: null,
            width: null,
            height: null,
          },
        ],
      };
      prisma.$transaction.mockResolvedValue([created, {}]);

      const result = await service.sendImage(
        'user-1',
        { conversationId: 'conv-1', text: 'une légende' },
        buildImageFile(),
      );

      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'attachment', 'jpg');
      expect(result.type).toBe('IMAGE');
      expect(result.attachments).toEqual([
        {
          id: 'att-1',
          url: '/api/messages/attachments/att-1',
          mimeType: 'image/jpeg',
          sizeBytes: 123,
          type: 'IMAGE',
          fileName: null,
          durationSeconds: null,
          width: null,
          height: null,
        },
      ]);
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2'],
        'message:new',
        expect.objectContaining({ type: 'IMAGE' }),
      );
    });
  });

  describe('sendMedia', () => {
    function buildVideoFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
      return buildImageFile({
        fieldname: 'media',
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        ...overrides,
      });
    }

    it("refuse si aucun fichier n'est fourni", async () => {
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, []),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse plus de fichiers que la limite de l’album', async () => {
      const files = Array.from({ length: 11 }, () => buildImageFile());
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, files),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse un type MIME non supporté (aucun fichier stocké, même les valides)', async () => {
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, [
          buildImageFile(),
          buildImageFile({ mimetype: 'application/pdf' }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse une vidéo dépassant la limite vidéo (distincte de la limite image)', async () => {
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, [
          buildVideoFile({ size: 51 * 1024 * 1024 }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuse d'envoyer dans une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);
      await expect(
        service.sendMedia('user-1', { conversationId: 'conv-1' }, [buildImageFile()]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('stocke chaque fichier avec sa position, classe image/vidéo, et crée un seul message MEDIA_ALBUM', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      storage.save
        .mockResolvedValueOnce({ key: 'attachment/1.jpg', sizeBytes: 111 })
        .mockResolvedValueOnce({ key: 'attachment/2.mp4', sizeBytes: 222 });
      const created = {
        ...buildMessage({ type: 'MEDIA_ALBUM', text: null }),
        reads: [],
        attachments: [
          {
            id: 'att-1',
            mimeType: 'image/jpeg',
            sizeBytes: 111,
            type: 'IMAGE',
            fileName: 'a.jpg',
            durationSeconds: null,
            width: 800,
            height: 600,
          },
          {
            id: 'att-2',
            mimeType: 'video/mp4',
            sizeBytes: 222,
            type: 'VIDEO',
            fileName: 'b.mp4',
            durationSeconds: 12,
            width: 1280,
            height: 720,
          },
        ],
      };
      prisma.$transaction.mockResolvedValue([created, {}]);

      const result = await service.sendMedia(
        'user-1',
        {
          conversationId: 'conv-1',
          meta: JSON.stringify([
            { fileName: 'a.jpg', width: 800, height: 600 },
            { fileName: 'b.mp4', durationSeconds: 12, width: 1280, height: 720 },
          ]),
        },
        [buildImageFile(), buildVideoFile()],
      );

      expect(storage.save).toHaveBeenNthCalledWith(1, expect.any(Buffer), 'attachment', 'jpg');
      expect(storage.save).toHaveBeenNthCalledWith(2, expect.any(Buffer), 'attachment', 'mp4');

      // mock.calls est typé `any[]` par Jest (jest.Mock non générique, comme
      // ailleurs dans ce fichier) — sans danger ici, assert de test uniquement.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.message.create.mock.calls[0][0] as {
        data: { type: string; attachments: { create: Array<Record<string, unknown>> } };
      };
      expect(createCall.data.type).toBe('MEDIA_ALBUM');
      expect(createCall.data.attachments.create).toEqual([
        expect.objectContaining({
          type: 'IMAGE',
          position: 0,
          fileName: 'a.jpg',
          width: 800,
          height: 600,
          durationSeconds: null,
        }),
        expect.objectContaining({
          type: 'VIDEO',
          position: 1,
          fileName: 'b.mp4',
          width: 1280,
          height: 720,
          durationSeconds: 12,
        }),
      ]);

      expect(result.type).toBe('MEDIA_ALBUM');
      expect(result.attachments).toHaveLength(2);
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2'],
        'message:new',
        expect.objectContaining({ type: 'MEDIA_ALBUM' }),
      );
    });

    it('ignore un JSON de métadonnées invalide plutôt que d’échouer (tout retombe sur null)', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      storage.save.mockResolvedValue({ key: 'attachment/1.jpg', sizeBytes: 111 });
      const created = {
        ...buildMessage({ type: 'MEDIA_ALBUM', text: null }),
        reads: [],
        attachments: [
          {
            id: 'att-1',
            mimeType: 'image/jpeg',
            sizeBytes: 111,
            type: 'IMAGE',
            fileName: null,
            durationSeconds: null,
            width: null,
            height: null,
          },
        ],
      };
      prisma.$transaction.mockResolvedValue([created, {}]);

      await service.sendMedia('user-1', { conversationId: 'conv-1', meta: '{not valid json' }, [
        buildImageFile(),
      ]);

      // mock.calls est typé `any[]` par Jest (jest.Mock non générique, comme
      // ailleurs dans ce fichier) — sans danger ici, assert de test uniquement.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.message.create.mock.calls[0][0] as {
        data: { attachments: { create: Array<Record<string, unknown>> } };
      };
      expect(createCall.data.attachments.create[0]).toEqual(
        expect.objectContaining({
          fileName: null,
          width: null,
          height: null,
          durationSeconds: null,
        }),
      );
    });

    it('notifie avec un aperçu adapté au nombre/type de médias (sans légende)', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      storage.save.mockResolvedValue({ key: 'attachment/1.mp4', sizeBytes: 111 });
      const created = {
        ...buildMessage({ type: 'MEDIA_ALBUM', text: null }),
        reads: [],
        attachments: [
          {
            id: 'att-1',
            mimeType: 'video/mp4',
            sizeBytes: 111,
            type: 'VIDEO',
            fileName: null,
            durationSeconds: null,
            width: null,
            height: null,
          },
        ],
      };
      prisma.$transaction.mockResolvedValue([created, {}]);

      await service.sendMedia('user-1', { conversationId: 'conv-1' }, [buildVideoFile()]);

      expect(notifications.create).toHaveBeenCalledWith(
        'user-2',
        'NEW_MESSAGE',
        expect.objectContaining({ preview: '🎥 Vidéo' }),
      );
    });
  });

  describe('streamAttachment', () => {
    it('refuse si la pièce jointe est introuvable', async () => {
      prisma.attachment.findUnique.mockResolvedValue(null);

      await expect(service.streamAttachment('user-1', 'att-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si l'appelant n'est pas membre de la conversation du message parent", async () => {
      prisma.attachment.findUnique.mockResolvedValue({
        id: 'att-1',
        url: 'attachment/photo.jpg',
        mimeType: 'image/jpeg',
        message: buildMessage({ conversationId: 'conv-1' }),
      });
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.streamAttachment('user-1', 'att-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si le fichier n'existe plus sur le stockage", async () => {
      prisma.attachment.findUnique.mockResolvedValue({
        id: 'att-1',
        url: 'attachment/photo.jpg',
        mimeType: 'image/jpeg',
        message: buildMessage({ conversationId: 'conv-1' }),
      });
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      storage.exists.mockResolvedValue(false);

      await expect(service.streamAttachment('user-1', 'att-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("renvoie le flux avec le bon type MIME déduit de l'extension stockée", async () => {
      prisma.attachment.findUnique.mockResolvedValue({
        id: 'att-1',
        url: 'attachment/photo.png',
        mimeType: 'image/jpeg', // volontairement différent : l'extension stockée doit primer
        message: buildMessage({ conversationId: 'conv-1' }),
      });
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      const fakeStream = { pipe: jest.fn() };
      storage.createReadStream.mockReturnValue(fakeStream);

      const result = await service.streamAttachment('user-1', 'att-1');

      expect(result.mimeType).toBe('image/png');
      expect(result.stream).toBe(fakeStream);
    });
  });

  describe('edit', () => {
    it("refuse de modifier le message d'un autre utilisateur", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage({ senderId: 'autre-user' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      await expect(service.edit('user-1', 'msg-1', { text: 'modifié' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    it("refuse si l'appelant n'est plus membre de la conversation", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage());
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.edit('user-1', 'msg-1', { text: 'modifié' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('modifie le message et horodate editedAt', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([]);
      prisma.message.update.mockResolvedValue({
        ...buildMessage({ text: 'modifié', editedAt: new Date() }),
        reads: [],
      });

      const result = await service.edit('user-1', 'msg-1', { text: 'modifié' });

      expect(result.text).toBe('modifié');
      expect(result.editedAt).not.toBeNull();
    });
  });

  describe('remove', () => {
    it('est idempotent : ne relance pas de suppression sur un message déjà supprimé', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage({ deletedAt: new Date() }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      await service.remove('user-1', 'msg-1');

      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    it('vide le texte et horodate deletedAt', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([]);
      prisma.message.update.mockResolvedValue({
        ...buildMessage({ text: null, deletedAt: new Date() }),
        reads: [],
        attachments: [],
      });

      const result = await service.remove('user-1', 'msg-1');

      expect(result.text).toBeNull();
      expect(result.deletedAt).not.toBeNull();
    });

    it('efface aussi le fichier de la pièce jointe pour un message IMAGE', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessage({ type: 'IMAGE' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([]);
      prisma.message.update.mockResolvedValue({
        ...buildMessage({ type: 'IMAGE', text: null, deletedAt: new Date() }),
        reads: [],
        attachments: [{ id: 'att-1', mimeType: 'image/jpeg', sizeBytes: 123 }],
      });
      prisma.attachment.findMany.mockResolvedValue([{ id: 'att-1', url: 'attachment/photo.jpg' }]);

      await service.remove('user-1', 'msg-1');

      expect(storage.delete).toHaveBeenCalledWith('attachment/photo.jpg');
    });
  });

  describe('list', () => {
    it("refuse de lister les messages d'une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.list('user-1', 'conv-1', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('renvoie les messages en ordre chronologique avec accusé de lecture', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      const readAt = new Date();
      const older = { ...buildMessage({ id: 'msg-1', text: 'plus ancien' }), reads: [] };
      const newer = {
        ...buildMessage({ id: 'msg-2', text: 'plus récent' }),
        reads: [{ userId: 'user-2', readAt }],
      };
      // Le service demande `limit + 1` (desc) pour détecter s'il reste une page.
      prisma.message.findMany.mockResolvedValue([newer, older]);

      const result = await service.list('user-1', 'conv-1', { limit: 2 });

      expect(result.items.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
      expect(result.items[1]?.readAt).toEqual(readAt);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('search', () => {
    it("refuse de rechercher dans une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.search('user-1', 'conv-1', 'salut')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('filtre par texte (insensible à la casse), jamais un message supprimé', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.message.findMany.mockResolvedValue([
        { ...buildMessage({ text: 'Salut toi' }), reads: [] },
      ]);

      const result = await service.search('user-1', 'conv-1', 'salut');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'conv-1',
            deletedAt: null,
            text: { contains: 'salut', mode: 'insensitive' },
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('pagine par curseur comme les autres listes', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      const rows = Array.from({ length: 3 }, (_, i) => ({
        ...buildMessage({ id: `msg-${i}`, text: 'salut' }),
        reads: [],
      }));
      prisma.message.findMany.mockResolvedValue(rows);

      const result = await service.search('user-1', 'conv-1', 'salut', undefined, 2);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('msg-1');
    });
  });

  describe('listAroundMessage', () => {
    it("refuse pour une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.listAroundMessage('user-1', 'conv-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.message.findUnique).not.toHaveBeenCalled();
    });

    it("404 si le message n'existe pas ou appartient à une autre conversation", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.listAroundMessage('user-1', 'conv-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.message.findUnique.mockResolvedValue({
        conversationId: 'conv-autre',
        createdAt: new Date(),
      });
      await expect(service.listAroundMessage('user-1', 'conv-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('renvoie les messages avant (inclus) et après le message ciblé, en ordre chronologique', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      const targetDate = new Date('2026-01-01T10:00:00Z');
      prisma.message.findUnique.mockResolvedValue({
        conversationId: 'conv-1',
        createdAt: targetDate,
      });

      const olderAndSelf = [
        { ...buildMessage({ id: 'msg-2', text: 'cible' }), reads: [] }, // le plus récent des "<=", donc la cible elle-même
        { ...buildMessage({ id: 'msg-1', text: 'avant' }), reads: [] },
      ];
      const newer = [{ ...buildMessage({ id: 'msg-3', text: 'après' }), reads: [] }];
      prisma.message.findMany.mockResolvedValueOnce(olderAndSelf).mockResolvedValueOnce(newer);

      const result = await service.listAroundMessage('user-1', 'conv-1', 'msg-2');

      expect(result.items.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
      expect(result.matchedMessageId).toBe('msg-2');
      expect(result.hasOlder).toBe(false);
    });
  });

  describe('listMedia', () => {
    it("refuse de lister les médias d'une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.listMedia('user-1', 'conv-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.attachment.findMany).not.toHaveBeenCalled();
    });

    it('renvoie les pièces jointes de la conversation, les plus récentes en premier, avec une URL authentifiée', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.attachment.findMany.mockResolvedValue([
        {
          id: 'att-2',
          mimeType: 'image/jpeg',
          sizeBytes: 500,
          type: 'IMAGE',
          fileName: null,
          durationSeconds: null,
          width: 800,
          height: 600,
        },
      ]);

      const result = await service.listMedia('user-1', 'conv-1');

      expect(prisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { message: { conversationId: 'conv-1', deletedAt: null } },
          orderBy: { message: { createdAt: 'desc' } },
        }),
      );
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'att-2',
          url: '/api/messages/attachments/att-2',
          type: 'IMAGE',
        }),
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it("pagine par curseur — jamais toute la galerie d'un coup, même avec des centaines de médias", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      // Le service demande `limit + 1` pour détecter s'il reste une page.
      const extra = Array.from({ length: 3 }, (_, i) => ({
        id: `att-${i}`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        type: 'IMAGE' as const,
        fileName: null,
        durationSeconds: null,
        width: null,
        height: null,
      }));
      prisma.attachment.findMany.mockResolvedValue(extra);

      const result = await service.listMedia('user-1', 'conv-1', undefined, 2);

      expect(prisma.attachment.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('att-1');
    });

    it('reprend après le curseur fourni, sans skip côté service sans curseur', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.attachment.findMany.mockResolvedValue([]);

      await service.listMedia('user-1', 'conv-1', 'att-5', 8);

      expect(prisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'att-5' }, skip: 1 }),
      );
    });

    it("ne renvoie jamais les pièces jointes d'un message supprimé (exclues côté requête)", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.attachment.findMany.mockResolvedValue([]);

      await service.listMedia('user-1', 'conv-1');

      expect(prisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: expect.objectContaining({ message: expect.objectContaining({ deletedAt: null }) }),
        }),
      );
    });
  });

  describe('markConversationRead', () => {
    it("refuse pour une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.markConversationRead('user-1', 'conv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('crée les accusés de lecture, marque livré au passage et diffuse message:read', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }]);
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      await service.markConversationRead('user-1', 'conv-1');

      // Matchers Jest imbriqués typés `any` dans @types/jest — sans danger
      // ici, ce sont des assertions de test, pas du code applicatif.
      expect(prisma.messageRead.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            { messageId: 'msg-1', userId: 'user-1', readAt: expect.any(Date) },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            { messageId: 'msg-2', userId: 'user-1', readAt: expect.any(Date) },
          ],
        }),
      );
      expect(prisma.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: expect.objectContaining({ id: { in: ['msg-1', 'msg-2'] } }),
        }),
      );
      // Inclut aussi le lecteur lui-même (pas seulement l'autre membre) :
      // ses propres autres appareils doivent remettre à zéro leur badge
      // non-lu pour cette conversation (section 21-22, synchronisation
      // multi-appareils) — voir le commentaire dans markConversationRead.
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2', 'user-1'],
        'message:read',
        expect.objectContaining({ conversationId: 'conv-1', readerId: 'user-1' }),
      );
    });

    it("ne crée rien s'il n'y a aucun message non lu, mais avance lastReadAt", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.message.findMany.mockResolvedValue([]);

      await service.markConversationRead('user-1', 'conv-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.conversationMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId_userId: { conversationId: 'conv-1', userId: 'user-1' } },
        }),
      );
      expect(events.emitToUsers).not.toHaveBeenCalled();
    });
  });
});
