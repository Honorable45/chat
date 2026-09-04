import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("n'est pas configuré par défaut (TRANSLATION_PROVIDER absent)", () => {
    delete process.env.TRANSLATION_PROVIDER;
    expect(new TranslationService().isConfigured()).toBe(false);
  });

  it('est configuré avec un provider connu et sa clé', () => {
    process.env.TRANSLATION_PROVIDER = 'deepl';
    process.env.TRANSLATION_API_KEY = 'key:fx';
    expect(new TranslationService().isConfigured()).toBe(true);
  });

  it('reste non configuré si TRANSLATION_PROVIDER="deepl" mais TRANSLATION_API_KEY est absent', () => {
    process.env.TRANSLATION_PROVIDER = 'deepl';
    delete process.env.TRANSLATION_API_KEY;
    expect(new TranslationService().isConfigured()).toBe(false);
  });
});
