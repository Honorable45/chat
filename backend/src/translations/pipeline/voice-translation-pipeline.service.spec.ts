import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryProvider } from '../../uploads/cloudinary.provider';
import { StorageService } from '../../uploads/storage.service';
import { EventsGateway } from '../../websocket/events.gateway';
import { SpeechToTextService } from '../speech-to-text/speech-to-text.service';
import { TextToSpeechService } from '../text-to-speech/text-to-speech.service';
import { TranslationService } from '../translation/translation.service';
import { VoiceIdentityService } from '../voice-identity/voice-identity.service';
import { VoiceTranslationPipelineService } from './voice-translation-pipeline.service';

function buildMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    senderId: 'user-1',
    voiceMessage: {
      id: 'voice-1',
      audioStorageKey: 'voice/abc.wav',
      audioStorageProvider: 'LOCAL' as const,
      audioMimeType: 'audio/wav',
    },
    conversation: { members: [{ userId: 'user-1' }, { userId: 'user-2' }] },
    ...overrides,
  };
}

// setImmediate laisse les micro/macro-tâches du fire-and-forget se dérouler
// avant que l'assertion ne s'exécute (runInBackground n'est jamais awaited).
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('VoiceTranslationPipelineService', () => {
  let prisma: {
    message: { findUnique: jest.Mock };
    voiceMessage: { update: jest.Mock; findUnique: jest.Mock };
    language: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    messageTranslation: { upsert: jest.Mock; update: jest.Mock };
  };
  let storage: { readFile: jest.Mock; save: jest.Mock };
  let speechToText: { isConfigured: jest.Mock; transcribe: jest.Mock };
  let translation: { isConfigured: jest.Mock; translate: jest.Mock };
  let textToSpeech: { isConfigured: jest.Mock; synthesize: jest.Mock };
  let voiceIdentity: { resolveVoiceReference: jest.Mock };
  let events: { emitToUsers: jest.Mock };
  let cloudinary: {
    isConfigured: jest.Mock;
    upload: jest.Mock;
    getSignedUrl: jest.Mock;
    delete: jest.Mock;
  };
  let service: VoiceTranslationPipelineService;

  beforeEach(() => {
    prisma = {
      message: { findUnique: jest.fn().mockResolvedValue(buildMessage()) },
      voiceMessage: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'voice-1' }),
      },
      language: { findUnique: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      messageTranslation: {
        upsert: jest.fn().mockResolvedValue({ id: 'translation-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      readFile: jest.fn().mockResolvedValue(Buffer.alloc(10)),
      save: jest.fn().mockResolvedValue({ key: 'translated-voice/xyz.mp3', sizeBytes: 10 }),
    };
    speechToText = { isConfigured: jest.fn().mockReturnValue(false), transcribe: jest.fn() };
    translation = { isConfigured: jest.fn().mockReturnValue(false), translate: jest.fn() };
    textToSpeech = { isConfigured: jest.fn().mockReturnValue(false), synthesize: jest.fn() };
    voiceIdentity = { resolveVoiceReference: jest.fn().mockResolvedValue(null) };
    events = { emitToUsers: jest.fn() };
    // Non configuré par défaut : chaque test existant continue de lire/écrire
    // via StorageService (LOCAL) — voir describe('Cloudinary', ...) plus bas.
    cloudinary = {
      isConfigured: jest.fn().mockReturnValue(false),
      upload: jest.fn(),
      getSignedUrl: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new VoiceTranslationPipelineService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      speechToText as unknown as SpeechToTextService,
      translation as unknown as TranslationService,
      textToSpeech as unknown as TextToSpeechService,
      voiceIdentity as unknown as VoiceIdentityService,
      events as unknown as EventsGateway,
      cloudinary as unknown as CloudinaryProvider,
    );
  });

  function mockSuccessfulTranslationSetup() {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });
    translation.isConfigured.mockReturnValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-2', preferredReceiveLanguage: { id: 'lang-en', code: 'en' } },
    ]);
    translation.translate.mockResolvedValue({ translatedText: 'Hello' });
  }

  it("ne fait rien si le message n'existe pas ou n'est pas un vocal", async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    service.runInBackground('msg-inconnu');
    await flush();

    expect(speechToText.transcribe).not.toHaveBeenCalled();
    expect(events.emitToUsers).not.toHaveBeenCalled();
  });

  it("ne tente aucune transcription si aucun fournisseur STT n'est configuré", async () => {
    speechToText.isConfigured.mockReturnValue(false);

    service.runInBackground('msg-1');
    await flush();

    expect(speechToText.transcribe).not.toHaveBeenCalled();
    expect(events.emitToUsers).not.toHaveBeenCalled();
  });

  it('transcrit, met à jour le vocal et diffuse translation:completed (stage transcription)', async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });

    service.runInBackground('msg-1');
    await flush();

    expect(prisma.voiceMessage.update).toHaveBeenCalledWith({
      where: { messageId: 'msg-1' },
      data: { transcript: 'Bonjour', detectedLanguageId: 'lang-fr' },
    });
    expect(events.emitToUsers).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'translation:completed',
      expect.objectContaining({ stage: 'transcription', transcript: 'Bonjour' }),
    );
  });

  it('diffuse translation:failed (stage transcription) si le fournisseur STT échoue', async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockRejectedValue(new Error('panne'));

    service.runInBackground('msg-1');
    await flush();

    expect(events.emitToUsers).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'translation:failed',
      expect.objectContaining({ stage: 'transcription' }),
    );
    expect(prisma.voiceMessage.update).not.toHaveBeenCalled();
  });

  it("n'enchaîne pas sur la traduction si la langue détectée n'est pas reconnue", async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'zz' });
    prisma.language.findUnique.mockResolvedValue(null); // "zz" inconnu de notre registre
    translation.isConfigured.mockReturnValue(true);

    service.runInBackground('msg-1');
    await flush();

    expect(translation.translate).not.toHaveBeenCalled();
  });

  it("ne traduit pas si aucun fournisseur de traduction n'est configuré", async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });
    translation.isConfigured.mockReturnValue(false);

    service.runInBackground('msg-1');
    await flush();

    expect(translation.translate).not.toHaveBeenCalled();
  });

  it('ne traduit pas vers une langue que le destinataire parle déjà (langue cible = langue source)', async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });
    translation.isConfigured.mockReturnValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-2', preferredReceiveLanguage: { id: 'lang-fr', code: 'fr' } },
    ]);

    service.runInBackground('msg-1');
    await flush();

    expect(translation.translate).not.toHaveBeenCalled();
  });

  it('traduit vers la langue préférée du destinataire et diffuse translation:completed (stage translation)', async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });
    translation.isConfigured.mockReturnValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-2', preferredReceiveLanguage: { id: 'lang-en', code: 'en' } },
    ]);
    translation.translate.mockResolvedValue({ translatedText: 'Hello' });

    service.runInBackground('msg-1');
    await flush();

    expect(translation.translate).toHaveBeenCalledWith('Bonjour', 'fr', 'en');
    expect(prisma.messageTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          voiceMessageId_targetLanguageId: {
            voiceMessageId: 'voice-1',
            targetLanguageId: 'lang-en',
          },
        },
      }),
    );
    expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'translation-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ translatedText: 'Hello', status: 'COMPLETED' }),
      }),
    );
    expect(events.emitToUsers).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'translation:completed',
      expect.objectContaining({
        stage: 'translation',
        targetLanguageCode: 'en',
        translatedText: 'Hello',
      }),
    );
  });

  it('marque la traduction FAILED et diffuse translation:failed si le fournisseur échoue', async () => {
    speechToText.isConfigured.mockReturnValue(true);
    speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
    prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });
    translation.isConfigured.mockReturnValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-2', preferredReceiveLanguage: { id: 'lang-en', code: 'en' } },
    ]);
    translation.translate.mockRejectedValue(new Error('quota dépassé'));

    service.runInBackground('msg-1');
    await flush();

    expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'quota dépassé' }),
      }),
    );
    expect(events.emitToUsers).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'translation:failed',
      expect.objectContaining({ stage: 'translation', targetLanguageCode: 'en' }),
    );
  });

  describe('synthèse vocale (TTS)', () => {
    it("ne tente aucune synthèse si aucun fournisseur TTS n'est configuré", async () => {
      mockSuccessfulTranslationSetup();
      textToSpeech.isConfigured.mockReturnValue(false);

      service.runInBackground('msg-1');
      await flush();

      expect(textToSpeech.synthesize).not.toHaveBeenCalled();
    });

    it("synthétise sans voix clonée quand l'expéditeur n'a pas donné son consentement", async () => {
      mockSuccessfulTranslationSetup();
      textToSpeech.isConfigured.mockReturnValue(true);
      voiceIdentity.resolveVoiceReference.mockResolvedValue(null); // pas de consentement / pas de modèle
      textToSpeech.synthesize.mockResolvedValue({ audio: Buffer.alloc(5), mimeType: 'audio/mpeg' });

      service.runInBackground('msg-1');
      await flush();

      expect(voiceIdentity.resolveVoiceReference).toHaveBeenCalledWith('user-1'); // l'expéditeur, pas le destinataire
      expect(textToSpeech.synthesize).toHaveBeenCalledWith('Hello', 'en', undefined);
      expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ usedVoiceCloning: false }),
        }),
      );
    });

    it('synthétise avec la voix clonée quand le consentement et le modèle existent — jamais sans les deux (section 15)', async () => {
      mockSuccessfulTranslationSetup();
      textToSpeech.isConfigured.mockReturnValue(true);
      voiceIdentity.resolveVoiceReference.mockResolvedValue({ voiceModelId: 'model-abc' });
      textToSpeech.synthesize.mockResolvedValue({ audio: Buffer.alloc(5), mimeType: 'audio/mpeg' });

      service.runInBackground('msg-1');
      await flush();

      expect(textToSpeech.synthesize).toHaveBeenCalledWith('Hello', 'en', {
        voiceModelId: 'model-abc',
      });
      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'translated-voice', 'mp3');
      expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            translatedAudioStorageKey: 'translated-voice/xyz.mp3',
            usedVoiceCloning: true,
          }),
        }),
      );
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        'translation:completed',
        expect.objectContaining({ stage: 'tts', usedVoiceCloning: true }),
      );
    });

    it('diffuse translation:failed (stage tts) si la synthèse échoue, sans toucher au texte déjà traduit', async () => {
      mockSuccessfulTranslationSetup();
      textToSpeech.isConfigured.mockReturnValue(true);
      textToSpeech.synthesize.mockRejectedValue(new Error('fournisseur TTS en panne'));

      service.runInBackground('msg-1');
      await flush();

      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        'translation:failed',
        expect.objectContaining({ stage: 'tts', targetLanguageCode: 'en' }),
      );
      // Le texte traduit reste acquis : seul le second appel à update (TTS)
      // est absent, pas celui qui a marqué la traduction texte COMPLETED.
      expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });
  });

  describe('Cloudinary', () => {
    it('télécharge le vocal via son URL signée pour le transcrire (jamais storage.readFile)', async () => {
      prisma.message.findUnique.mockResolvedValue(
        buildMessage({
          voiceMessage: {
            id: 'voice-1',
            audioStorageKey: 'glotta/voice/abc',
            audioStorageProvider: 'CLOUDINARY',
            audioMimeType: 'audio/webm',
          },
        }),
      );
      cloudinary.getSignedUrl.mockReturnValue('https://res.cloudinary.com/demo/signed-voice');
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      } as never);
      speechToText.isConfigured.mockReturnValue(true);
      speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
      prisma.language.findUnique.mockResolvedValue({ id: 'lang-fr', code: 'fr' });

      service.runInBackground('msg-1');
      await flush();

      expect(cloudinary.getSignedUrl).toHaveBeenCalledWith('glotta/voice/abc', 'video');
      expect(fetchSpy).toHaveBeenCalledWith('https://res.cloudinary.com/demo/signed-voice');
      expect(storage.readFile).not.toHaveBeenCalled();
      expect(speechToText.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm');
      fetchSpy.mockRestore();
    });

    it('diffuse translation:failed (stage transcription) si le téléchargement Cloudinary échoue', async () => {
      prisma.message.findUnique.mockResolvedValue(
        buildMessage({
          voiceMessage: {
            id: 'voice-1',
            audioStorageKey: 'glotta/voice/abc',
            audioStorageProvider: 'CLOUDINARY',
            audioMimeType: 'audio/webm',
          },
        }),
      );
      cloudinary.getSignedUrl.mockReturnValue('https://res.cloudinary.com/demo/signed-voice');
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 404 } as never);
      speechToText.isConfigured.mockReturnValue(true);

      service.runInBackground('msg-1');
      await flush();

      expect(speechToText.transcribe).not.toHaveBeenCalled();
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        'translation:failed',
        expect.objectContaining({ stage: 'transcription' }),
      );
      fetchSpy.mockRestore();
    });

    it('la synthèse vocale (TTS) uploade sur Cloudinary quand configuré, jamais StorageService', async () => {
      mockSuccessfulTranslationSetup();
      cloudinary.isConfigured.mockReturnValue(true);
      cloudinary.upload.mockResolvedValue({ publicId: 'glotta/translated-voice/xyz' });
      cloudinary.getSignedUrl.mockReturnValue('https://res.cloudinary.com/demo/signed-tts');
      textToSpeech.isConfigured.mockReturnValue(true);
      textToSpeech.synthesize.mockResolvedValue({ audio: Buffer.alloc(5), mimeType: 'audio/mpeg' });

      service.runInBackground('msg-1');
      await flush();

      expect(cloudinary.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        'translated-voice',
        'video',
      );
      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.messageTranslation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            translatedAudioStorageKey: 'glotta/translated-voice/xyz',
            translatedAudioStorageProvider: 'CLOUDINARY',
          }),
        }),
      );
      expect(events.emitToUsers).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        'translation:completed',
        expect.objectContaining({
          stage: 'tts',
          audioUrl: 'https://res.cloudinary.com/demo/signed-tts',
        }),
      );
    });
  });
});
