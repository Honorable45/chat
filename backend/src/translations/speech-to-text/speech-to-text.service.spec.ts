import { SpeechToTextService } from './speech-to-text.service';

describe('SpeechToTextService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("n'est pas configuré par défaut (STT_PROVIDER absent)", () => {
    delete process.env.STT_PROVIDER;
    expect(new SpeechToTextService().isConfigured()).toBe(false);
  });

  it('est configuré avec un provider connu et sa clé', () => {
    process.env.STT_PROVIDER = 'groq';
    process.env.STT_API_KEY = 'key';
    expect(new SpeechToTextService().isConfigured()).toBe(true);
  });

  it(
    'reste non configuré si STT_PROVIDER="groq" mais STT_API_KEY est absent ' +
      '(régression : isConfigured() reflétait auparavant la variable brute, pas le provider réellement construit)',
    () => {
      process.env.STT_PROVIDER = 'groq';
      delete process.env.STT_API_KEY;
      expect(new SpeechToTextService().isConfigured()).toBe(false);
    },
  );
});
