import { BadRequestException } from '@nestjs/common';
import { LanguagesService } from '../languages/languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpeechToTextService } from '../translations/speech-to-text/speech-to-text.service';
import { TextToSpeechService } from '../translations/text-to-speech/text-to-speech.service';
import { TranslationService } from '../translations/translation/translation.service';
import { CallTranslationService } from './call-translation.service';

describe('CallTranslationService', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let languages: { findEnabledByCode: jest.Mock };
  let speechToText: { isConfigured: jest.Mock; transcribe: jest.Mock };
  let translation: { isConfigured: jest.Mock; translate: jest.Mock };
  let textToSpeech: { isConfigured: jest.Mock; synthesize: jest.Mock };
  let service: CallTranslationService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ primaryLanguage: { code: 'fr' } }),
      },
    };
    languages = { findEnabledByCode: jest.fn().mockResolvedValue({ id: 'lang', code: 'en' }) };
    speechToText = {
      isConfigured: jest.fn().mockReturnValue(true),
      transcribe: jest.fn().mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' }),
    };
    translation = {
      isConfigured: jest.fn().mockReturnValue(true),
      translate: jest.fn().mockResolvedValue({ translatedText: 'Hello' }),
    };
    textToSpeech = {
      isConfigured: jest.fn().mockReturnValue(true),
      synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('aa'), mimeType: 'audio/mpeg' }),
    };
    service = new CallTranslationService(
      prisma as unknown as PrismaService,
      languages as unknown as LanguagesService,
      speechToText as unknown as SpeechToTextService,
      translation as unknown as TranslationService,
      textToSpeech as unknown as TextToSpeechService,
    );
  });

  const chunk = (over: Partial<Parameters<CallTranslationService['processChunk']>[0]> = {}) => ({
    callId: 'call-1',
    speakerId: 'alice',
    listenerId: 'bob',
    audio: Buffer.from('some-audio'),
    mimeType: 'audio/webm',
    ...over,
  });

  describe('isEnabled', () => {
    it('exige transcription ET traduction (synthèse facultative)', () => {
      expect(service.isEnabled()).toBe(true);

      speechToText.isConfigured.mockReturnValue(false);
      expect(service.isEnabled()).toBe(false);

      speechToText.isConfigured.mockReturnValue(true);
      translation.isConfigured.mockReturnValue(false);
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('setReceiveLanguage / getReceiveLanguage / clear', () => {
    it('valide le code auprès du registre et le mémorise par appel et par utilisateur', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');

      expect(languages.findEnabledByCode).toHaveBeenCalledWith('en');
      expect(service.getReceiveLanguage('call-1', 'bob')).toBe('en');
      expect(service.getReceiveLanguage('call-1', 'alice')).toBeNull();
    });

    it('rejette une langue inconnue', async () => {
      languages.findEnabledByCode.mockRejectedValue(new BadRequestException('inconnue'));
      await expect(service.setReceiveLanguage('call-1', 'bob', 'zz')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(service.getReceiveLanguage('call-1', 'bob')).toBeNull();
    });

    it('un code vide retire la préférence', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      await service.setReceiveLanguage('call-1', 'bob', null);
      expect(service.getReceiveLanguage('call-1', 'bob')).toBeNull();
    });

    it('clear oublie toute la session', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      service.clear('call-1');
      expect(service.getReceiveLanguage('call-1', 'bob')).toBeNull();
    });
  });

  describe('processChunk', () => {
    it('ne produit rien si la traduction est désactivée', async () => {
      translation.isConfigured.mockReturnValue(false);
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      expect(await service.processChunk(chunk())).toBeNull();
    });

    it("ne produit rien si l'auditeur n'a choisi aucune langue", async () => {
      expect(await service.processChunk(chunk())).toBeNull();
      expect(speechToText.transcribe).not.toHaveBeenCalled();
    });

    it('ne produit rien pour un fragment vide ou surdimensionné', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      expect(await service.processChunk(chunk({ audio: Buffer.alloc(0) }))).toBeNull();
      expect(
        await service.processChunk(chunk({ audio: Buffer.alloc(3 * 1024 * 1024) })),
      ).toBeNull();
    });

    it('ne produit rien si la transcription est vide', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      speechToText.transcribe.mockResolvedValue({ text: '   ', languageCode: 'fr' });
      expect(await service.processChunk(chunk())).toBeNull();
      expect(translation.translate).not.toHaveBeenCalled();
    });

    it('ne traduit pas si la langue parlée est déjà la langue de réception', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      speechToText.transcribe.mockResolvedValue({ text: 'Hello', languageCode: 'en' });
      expect(await service.processChunk(chunk())).toBeNull();
      expect(translation.translate).not.toHaveBeenCalled();
    });

    it('transcrit → traduit → synthétise pour la langue choisie par l’auditeur', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');

      const result = await service.processChunk(chunk());

      expect(translation.translate).toHaveBeenCalledWith('Bonjour', 'fr', 'en');
      expect(textToSpeech.synthesize).toHaveBeenCalledWith('Hello', 'en');
      expect(result).toEqual({
        originalText: 'Bonjour',
        translatedText: 'Hello',
        sourceLanguage: 'fr',
        targetLanguage: 'en',
        audioBase64: Buffer.from('aa').toString('base64'),
        audioMimeType: 'audio/mpeg',
      });
    });

    it('retombe sur la langue principale de l’émetteur si le STT ne détecte pas la langue', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: null });

      await service.processChunk(chunk());

      expect(translation.translate).toHaveBeenCalledWith('Bonjour', 'fr', 'en');
    });

    it('sous-titres seuls quand la synthèse vocale est indisponible', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      textToSpeech.isConfigured.mockReturnValue(false);

      const result = await service.processChunk(chunk());

      expect(result?.translatedText).toBe('Hello');
      expect(result?.audioBase64).toBeNull();
      expect(result?.audioMimeType).toBeNull();
    });

    it('ne lève jamais si un fournisseur échoue', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      speechToText.transcribe.mockRejectedValue(new Error('STT en panne'));
      expect(await service.processChunk(chunk())).toBeNull();

      speechToText.transcribe.mockResolvedValue({ text: 'Bonjour', languageCode: 'fr' });
      translation.translate.mockRejectedValue(new Error('quota'));
      expect(await service.processChunk(chunk())).toBeNull();
    });

    it('une synthèse vocale qui échoue laisse quand même les sous-titres', async () => {
      await service.setReceiveLanguage('call-1', 'bob', 'en');
      textToSpeech.synthesize.mockRejectedValue(new Error('TTS en panne'));

      const result = await service.processChunk(chunk());

      expect(result?.translatedText).toBe('Hello');
      expect(result?.audioBase64).toBeNull();
    });
  });
});
