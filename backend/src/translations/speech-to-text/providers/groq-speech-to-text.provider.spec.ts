import { ServiceUnavailableException } from '@nestjs/common';
import { GroqSpeechToTextProvider } from './groq-speech-to-text.provider';

describe('GroqSpeechToTextProvider', () => {
  let fetchMock: jest.Mock;
  let provider: GroqSpeechToTextProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    provider = new GroqSpeechToTextProvider('test-key');
  });

  it('transcrit et convertit le nom de langue Whisper en code ISO connu', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Bonjour le monde', language: 'french' }),
    });

    const result = await provider.transcribe(Buffer.from('audio'), 'audio/webm');

    expect(result).toEqual({ text: 'Bonjour le monde', languageCode: 'fr' });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it(
    'envoie l\'extension "wav" (pas "x-wav") pour un fichier "audio/x-wav" — ' +
      'régression : Groq refuse "x-wav" (HTTP 400, testé en conditions réelles), ' +
      'seule "wav" figure dans sa liste fermée d\'extensions acceptées',
    async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'ok', language: 'french' }),
      });

      await provider.transcribe(Buffer.from('audio'), 'audio/x-wav');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const form = options.body as FormData;
      const file = form.get('file') as File;
      expect(file.name).toBe('audio.wav');
    },
  );

  it('renvoie languageCode: null pour une langue Whisper non seedée dans ce projet', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Guten Tag', language: 'german' }),
    });

    const result = await provider.transcribe(Buffer.from('audio'), 'audio/webm');

    expect(result.languageCode).toBeNull();
  });

  it('lève ServiceUnavailableException sur une réponse HTTP en erreur', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid api key'),
    });

    await expect(provider.transcribe(Buffer.from('audio'), 'audio/webm')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lève ServiceUnavailableException si le réseau échoue', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(provider.transcribe(Buffer.from('audio'), 'audio/webm')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
