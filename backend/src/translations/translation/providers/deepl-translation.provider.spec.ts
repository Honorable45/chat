import { ServiceUnavailableException } from '@nestjs/common';
import { DeepLTranslationProvider } from './deepl-translation.provider';

describe('DeepLTranslationProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('utilise l\'hôte "api-free" pour une clé se terminant par ":fx"', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ translations: [{ text: 'Hello' }] }),
    });
    const provider = new DeepLTranslationProvider('abc123:fx');

    await provider.translate('Bonjour', 'fr', 'en');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
  });

  it('utilise l\'hôte "api" (Pro) pour une clé sans suffixe ":fx"', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ translations: [{ text: 'Hello' }] }),
    });
    const provider = new DeepLTranslationProvider('abc123');

    await provider.translate('Bonjour', 'fr', 'en');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.deepl.com/v2/translate');
  });

  it('ajoute la variante régionale par défaut pour EN et PT en langue cible', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ translations: [{ text: 'x' }] }),
    });
    const provider = new DeepLTranslationProvider('key:fx');

    await provider.translate('texte', 'fr', 'en');
    await provider.translate('texte', 'fr', 'pt');
    await provider.translate('texte', 'fr', 'es');

    const bodies = fetchMock.mock.calls.map(
      ([, options]) => (options as RequestInit).body as URLSearchParams,
    );
    expect(bodies[0].get('target_lang')).toBe('EN-US');
    expect(bodies[1].get('target_lang')).toBe('PT-PT');
    expect(bodies[2].get('target_lang')).toBe('ES'); // pas de variante nécessaire
  });

  it('renvoie le texte traduit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ translations: [{ text: 'Hello world' }] }),
    });
    const provider = new DeepLTranslationProvider('key:fx');

    const result = await provider.translate('Bonjour le monde', 'fr', 'en');

    expect(result).toEqual({ translatedText: 'Hello world' });
  });

  it('lève ServiceUnavailableException sur une réponse HTTP en erreur', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('quota exceeded'),
    });
    const provider = new DeepLTranslationProvider('key:fx');

    await expect(provider.translate('texte', 'fr', 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lève ServiceUnavailableException si la réponse ne contient aucune traduction', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ translations: [] }) });
    const provider = new DeepLTranslationProvider('key:fx');

    await expect(provider.translate('texte', 'fr', 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
