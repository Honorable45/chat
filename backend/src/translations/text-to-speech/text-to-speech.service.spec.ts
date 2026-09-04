import { TextToSpeechService } from './text-to-speech.service';

describe('TextToSpeechService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("n'est pas configuré par défaut (TTS_PROVIDER absent)", () => {
    delete process.env.TTS_PROVIDER;
    expect(new TextToSpeechService().isConfigured()).toBe(false);
  });

  it('est configuré avec un provider connu et sa clé', () => {
    process.env.TTS_PROVIDER = 'elevenlabs';
    process.env.TTS_API_KEY = 'key';
    expect(new TextToSpeechService().isConfigured()).toBe(true);
  });

  it('reste non configuré si TTS_PROVIDER="elevenlabs" mais TTS_API_KEY est absent', () => {
    process.env.TTS_PROVIDER = 'elevenlabs';
    delete process.env.TTS_API_KEY;
    expect(new TextToSpeechService().isConfigured()).toBe(false);
  });
});
