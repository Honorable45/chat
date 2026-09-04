import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConversationMember, Message, VoiceMessage } from '@prisma/client';
import { LanguagesService } from '../languages/languages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceTranslationPipelineService } from '../translations/pipeline/voice-translation-pipeline.service';
import { SpeechToTextService } from '../translations/speech-to-text/speech-to-text.service';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { VoiceService } from './voice.service';

function buildFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'audio',
    originalname: 'voice.wav',
    encoding: '7bit',
    mimetype: 'audio/wav',
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

function buildMessageWithVoice(
  overrides: Partial<Message> = {},
  voice: Partial<VoiceMessage> = {},
) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    type: 'VOICE' as const,
    text: null,
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    sentAt: new Date(),
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    voiceMessage: {
      id: 'voice-1',
      messageId: 'msg-1',
      audioStorageKey: 'voice/abc.wav',
      durationSeconds: 12,
      waveform: null,
      detectedLanguageId: null,
      languageOverridden: false,
      transcript: null,
      createdAt: new Date(),
      translations: [] as unknown[],
      ...voice,
    },
  };
}

describe('VoiceService', () => {
  let prisma: {
    message: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    conversation: { update: jest.Mock };
    conversationMember: { findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: {
    save: jest.Mock;
    exists: jest.Mock;
    createReadStream: jest.Mock;
    readFile: jest.Mock;
    delete: jest.Mock;
  };
  let events: { emitToUsers: jest.Mock };
  let presence: { isOnline: jest.Mock };
  let notifications: { create: jest.Mock };
  let speechToText: { isConfigured: jest.Mock; transcribe: jest.Mock };
  let languages: { findEnabledByCode: jest.Mock };
  let pipeline: { runInBackground: jest.Mock };
  let service: VoiceService;

  beforeEach(() => {
    prisma = {
      message: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      conversation: { update: jest.fn() },
      conversationMember: { findUnique: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    storage = {
      save: jest.fn().mockResolvedValue({ key: 'voice/abc.wav', sizeBytes: 2000 }),
      exists: jest.fn().mockResolvedValue(true),
      createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
      readFile: jest.fn().mockResolvedValue(Buffer.alloc(10)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    events = { emitToUsers: jest.fn() };
    presence = { isOnline: jest.fn().mockReturnValue(false) };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    speechToText = { isConfigured: jest.fn().mockReturnValue(false), transcribe: jest.fn() };
    languages = { findEnabledByCode: jest.fn() };
    pipeline = { runInBackground: jest.fn() };
    service = new VoiceService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      events as unknown as EventsGateway,
      presence as unknown as PresenceService,
      notifications as unknown as NotificationsService,
      speechToText as unknown as SpeechToTextService,
      languages as unknown as LanguagesService,
      pipeline as unknown as VoiceTranslationPipelineService,
    );
  });

  describe('send', () => {
    it("refuse si aucun fichier n'est fourni", async () => {
      await expect(
        service.send('user-1', { conversationId: 'conv-1', durationSeconds: 5 }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversationMember.findUnique).not.toHaveBeenCalled();
    });

    it('refuse un type MIME non supporté', async () => {
      const file = buildFile({ mimetype: 'application/x-executable' });
      await expect(
        service.send('user-1', { conversationId: 'conv-1', durationSeconds: 5 }, file),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('refuse un fichier trop volumineux', async () => {
      const file = buildFile({ size: 20 * 1024 * 1024 });
      await expect(
        service.send('user-1', { conversationId: 'conv-1', durationSeconds: 5 }, file),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("refuse d'envoyer dans une conversation dont on n'est pas membre", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.send('user-1', { conversationId: 'conv-1', durationSeconds: 5 }, buildFile()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuse un waveform qui n'est pas un tableau JSON de nombres", async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      await expect(
        service.send(
          'user-1',
          { conversationId: 'conv-1', durationSeconds: 5, waveform: '{"pas":"un tableau"}' },
          buildFile(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('stocke le fichier, crée le message, notifie les autres membres et lance le pipeline', async () => {
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      const created = buildMessageWithVoice();
      prisma.$transaction.mockResolvedValue([created, {}]);

      const result = await service.send(
        'user-1',
        { conversationId: 'conv-1', durationSeconds: 12, waveform: '[0.1,0.5]' },
        buildFile(),
      );

      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'voice', 'wav');
      expect(result.voice?.durationSeconds).toBe(12);
      expect(result.voice?.audioUrl).toBe('/api/voice/msg-1/audio');
      expect(result.voice?.translations).toEqual([]);
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2'],
        'message:new',
        expect.objectContaining({ id: 'msg-1' }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        'user-2',
        'NEW_VOICE_MESSAGE',
        expect.objectContaining({ messageId: 'msg-1' }),
      );
      // Le pipeline STT → traduction se déclenche systématiquement en tâche
      // de fond : c'est lui (pas VoiceService) qui décide s'il y a un
      // fournisseur configuré — voir voice-translation-pipeline.service.spec.ts.
      expect(pipeline.runInBackground).toHaveBeenCalledWith('msg-1');
    });
  });

  describe('streamAudio', () => {
    it("refuse pour un message qui n'est pas un vocal", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ type: 'TEXT' as never }));

      await expect(service.streamAudio('user-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si l'appelant n'est pas membre de la conversation", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.streamAudio('user-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse si le fichier n'existe plus sur le stockage", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      storage.exists.mockResolvedValue(false);

      await expect(service.streamAudio('user-1', 'msg-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("renvoie le flux avec le bon type MIME déduit de l'extension stockée", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      const result = await service.streamAudio('user-1', 'msg-1');

      // ".wav" est partagé par deux types MIME (audio/wav et audio/x-wav) ;
      // la table inversée retient le dernier déclaré — confirmé identique
      // en conditions réelles (voir le header Content-Type observé en test
      // manuel, section Phase 9 de PHASES.md).
      expect(result.mimeType).toBe('audio/x-wav');
      expect(storage.createReadStream).toHaveBeenCalledWith('voice/abc.wav');
    });
  });

  describe('getDetails', () => {
    it("refuse pour un message qui n'est pas un vocal", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ type: 'TEXT' as never }));

      await expect(service.getDetails('user-1', 'msg-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuse si l'appelant n'est pas membre de la conversation", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(null);

      await expect(service.getDetails('user-1', 'msg-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renvoie la transcription et les traductions déjà connues', async () => {
      const message = buildMessageWithVoice(
        {},
        { transcript: 'Bonjour', detectedLanguageId: 'lang-fr' },
      );
      // Relation chargée par l'include (VOICE_MESSAGE_INCLUDE), absente du
      // modèle VoiceMessage de base que connaît buildMessageWithVoice —
      // ajoutée ici pour ce test précis, comme pour `translations`.
      (message.voiceMessage as unknown as Record<string, unknown>).detectedLanguage = {
        id: 'lang-fr',
        code: 'fr',
        name: 'Français',
        nativeName: 'Français',
      };
      prisma.message.findUnique.mockResolvedValue(message);
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      const result = await service.getDetails('user-1', 'msg-1');

      expect(result.voice?.transcript).toBe('Bonjour');
      expect(result.voice?.detectedLanguage).toEqual({
        code: 'fr',
        name: 'Français',
        nativeName: 'Français',
      });
    });
  });

  describe('retranscribe', () => {
    it("refuse si aucun fournisseur n'est configuré (erreur immédiate, pas un 202 trompeur)", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      speechToText.isConfigured.mockReturnValue(false);

      await expect(service.retranscribe('user-1', 'msg-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(pipeline.runInBackground).not.toHaveBeenCalled();
    });

    it('relance le pipeline quand un fournisseur est configuré', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice());
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      speechToText.isConfigured.mockReturnValue(true);

      const result = await service.retranscribe('user-1', 'msg-1');

      expect(result).toEqual({ started: true });
      expect(pipeline.runInBackground).toHaveBeenCalledWith('msg-1');
    });
  });

  describe('remove', () => {
    it("refuse de supprimer le vocal d'un autre utilisateur", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ senderId: 'user-1' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership({ userId: 'user-2' }));

      await expect(service.remove('user-2', 'msg-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    it('est idempotent : ne relance pas de suppression sur un vocal déjà supprimé', async () => {
      prisma.message.findUnique.mockResolvedValue(
        buildMessageWithVoice({ senderId: 'user-1', deletedAt: new Date() }),
      );
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());

      await service.remove('user-1', 'msg-1');

      expect(prisma.message.update).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('marque deletedAt, efface le fichier et notifie les autres membres', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ senderId: 'user-1' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-2' }]);
      prisma.message.update.mockResolvedValue(
        buildMessageWithVoice({ senderId: 'user-1', deletedAt: new Date() }),
      );

      const result = await service.remove('user-1', 'msg-1');

      expect(storage.delete).toHaveBeenCalledWith('voice/abc.wav');
      expect(result.deletedAt).not.toBeNull();
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-2'],
        'message:deleted',
        expect.objectContaining({ id: 'msg-1' }),
      );
    });
  });

  describe('overrideLanguage', () => {
    it("refuse à quelqu'un d'autre que l'auteur du vocal", async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ senderId: 'user-1' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership({ userId: 'user-2' }));

      await expect(service.overrideLanguage('user-2', 'msg-1', 'fr')).rejects.toThrow(
        "Seul l'auteur du vocal peut corriger la langue détectée.",
      );
    });

    it('met à jour la langue détectée et marque languageOverridden', async () => {
      prisma.message.findUnique.mockResolvedValue(buildMessageWithVoice({ senderId: 'user-1' }));
      prisma.conversationMember.findUnique.mockResolvedValue(buildMembership());
      prisma.conversationMember.findMany.mockResolvedValue([]);
      languages.findEnabledByCode.mockResolvedValue({ id: 'lang-en', code: 'en' });
      prisma.message.update.mockResolvedValue(
        buildMessageWithVoice(
          { senderId: 'user-1' },
          { languageOverridden: true, detectedLanguageId: 'lang-en' },
        ),
      );

      const result = await service.overrideLanguage('user-1', 'msg-1', 'en');

      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            voiceMessage: {
              update: { detectedLanguageId: 'lang-en', languageOverridden: true },
            },
          },
        }),
      );
      expect(result.voice?.languageOverridden).toBe(true);
    });
  });
});
