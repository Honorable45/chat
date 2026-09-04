import { ServiceUnavailableException } from '@nestjs/common';
import { ElevenLabsTextToSpeechProvider } from './elevenlabs-text-to-speech.provider';

describe('ElevenLabsTextToSpeechProvider', () => {
  let fetchMock: jest.Mock;
  let provider: ElevenLabsTextToSpeechProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    provider = new ElevenLabsTextToSpeechProvider('test-key', 'default-voice-id');
  });

  it("utilise la voix par défaut quand aucune référence de voix clonée n'est fournie", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });

    await provider.synthesize('Hello', 'en');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/default-voice-id');
  });

  it('utilise la voix clonée fournie plutôt que la voix par défaut', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });

    await provider.synthesize('Hello', 'en', { voiceModelId: 'cloned-voice-id' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/cloned-voice-id');
  });

  it("renvoie l'audio produit avec le type MIME audio/mpeg", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(bytes) });

    const result = await provider.synthesize('Hello', 'en');

    expect(result.mimeType).toBe('audio/mpeg');
    expect(Buffer.compare(result.audio, Buffer.from(bytes))).toBe(0);
  });

  it('lève ServiceUnavailableException sur une réponse HTTP en erreur', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('invalid voice'),
    });

    await expect(provider.synthesize('Hello', 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lève ServiceUnavailableException si le réseau échoue', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(provider.synthesize('Hello', 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
