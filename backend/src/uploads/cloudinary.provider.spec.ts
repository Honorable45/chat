import { ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinarySdk } from 'cloudinary';
import { buildCloudinaryPublicUrl, CloudinaryProvider } from './cloudinary.provider';

const ENV_KEYS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_AUTH_TOKEN_KEY',
  'CLOUDINARY_SIGNED_URL_TTL_SECONDS',
] as const;

describe('CloudinaryProvider', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('renvoie false sans les 3 variables requises', () => {
      expect(new CloudinaryProvider().isConfigured()).toBe(false);
    });

    it('renvoie false si une seule des 3 variables manque', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      // CLOUDINARY_API_SECRET absent
      expect(new CloudinaryProvider().isConfigured()).toBe(false);
    });

    it('renvoie true avec les 3 variables présentes', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      expect(new CloudinaryProvider().isConfigured()).toBe(true);
    });
  });

  describe('isConfiguredForSignedMedia', () => {
    it("renvoie false si configuré mais sans CLOUDINARY_AUTH_TOKEN_KEY (éviterait une pièce jointe à jamais illisible)", () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      expect(new CloudinaryProvider().isConfiguredForSignedMedia()).toBe(false);
    });

    it('renvoie false si CLOUDINARY_AUTH_TOKEN_KEY présent mais pas les 3 variables de base', () => {
      process.env.CLOUDINARY_AUTH_TOKEN_KEY = 'token';
      expect(new CloudinaryProvider().isConfiguredForSignedMedia()).toBe(false);
    });

    it('renvoie true seulement avec les 3 variables de base ET CLOUDINARY_AUTH_TOKEN_KEY', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      process.env.CLOUDINARY_AUTH_TOKEN_KEY = 'token';
      expect(new CloudinaryProvider().isConfiguredForSignedMedia()).toBe(true);
    });
  });

  describe('getSignedUrl', () => {
    it("échoue explicitement si Cloudinary n'est pas configuré (jamais un lien non protégé)", () => {
      const provider = new CloudinaryProvider();
      expect(() => provider.getSignedUrl('glotta/attachment/abc', 'image')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('échoue explicitement si CLOUDINARY_AUTH_TOKEN_KEY manque, même configuré par ailleurs', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      const provider = new CloudinaryProvider();
      expect(() => provider.getSignedUrl('glotta/attachment/abc', 'image')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('renvoie une URL signée à jeton (aucun appel réseau, calcul local) quand tout est configuré', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      process.env.CLOUDINARY_AUTH_TOKEN_KEY = 'token-key-hex';
      const provider = new CloudinaryProvider();

      const url = provider.getSignedUrl('glotta/attachment/abc', 'image');

      expect(url).toContain('demo');
      expect(url).toContain('glotta/attachment/abc');
      expect(url).toContain('__cld_token__');
    });
  });

  describe('getPublicUrl', () => {
    it("échoue explicitement si Cloudinary n'est pas configuré", () => {
      const provider = new CloudinaryProvider();
      expect(() => provider.getPublicUrl('glotta/avatar/abc')).toThrow(ServiceUnavailableException);
    });

    it('renvoie une URL publique (jamais signée) quand configuré', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      const provider = new CloudinaryProvider();

      const url = provider.getPublicUrl('glotta/avatar/abc');

      expect(url).toBe('https://res.cloudinary.com/demo/image/upload/glotta/avatar/abc');
      expect(url).not.toContain('__cld_token__');
    });
  });

  describe('upload/uploadPublic/delete', () => {
    it("upload échoue explicitement si Cloudinary n'est pas configuré, sans appel réseau", async () => {
      const provider = new CloudinaryProvider();
      const uploadSpy = jest.spyOn(cloudinarySdk.uploader, 'upload');

      await expect(provider.upload(Buffer.from('x'), 'attachment', 'image')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('upload appelle le SDK avec resource_type et type="authenticated"', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      const provider = new CloudinaryProvider();
      jest
        .spyOn(cloudinarySdk.uploader, 'upload')
        .mockResolvedValue({ public_id: 'glotta/attachment/new123' } as never);

      const result = await provider.upload(Buffer.from('x'), 'attachment', 'video');

      expect(result.publicId).toBe('glotta/attachment/new123');
      expect(cloudinarySdk.uploader.upload).toHaveBeenCalledWith(
        expect.stringContaining('data:application/octet-stream;base64,'),
        expect.objectContaining({ resource_type: 'video', type: 'authenticated' }),
      );
    });

    it('uploadPublic appelle le SDK avec type="upload" (jamais authenticated)', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      const provider = new CloudinaryProvider();
      jest
        .spyOn(cloudinarySdk.uploader, 'upload')
        .mockResolvedValue({ public_id: 'glotta/avatar/new123' } as never);

      await provider.uploadPublic(Buffer.from('x'), 'avatar');

      expect(cloudinarySdk.uploader.upload).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ resource_type: 'image', type: 'upload' }),
      );
    });

    it("delete ne fait rien (jamais d'erreur) si Cloudinary n'est pas configuré", async () => {
      const provider = new CloudinaryProvider();
      const destroySpy = jest.spyOn(cloudinarySdk.uploader, 'destroy');

      await provider.delete('glotta/attachment/abc', 'image', 'authenticated');

      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('delete est best-effort : une erreur du SDK ne remonte jamais', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
      const provider = new CloudinaryProvider();
      jest.spyOn(cloudinarySdk.uploader, 'destroy').mockRejectedValue(new Error('network down'));

      await expect(
        provider.delete('glotta/attachment/abc', 'image', 'authenticated'),
      ).resolves.toBeUndefined();
    });
  });
});

describe('buildCloudinaryPublicUrl', () => {
  const original = process.env.CLOUDINARY_CLOUD_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = original;
  });

  it('renvoie null sans CLOUDINARY_CLOUD_NAME (jamais une URL cassée)', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(buildCloudinaryPublicUrl('glotta/avatar/abc')).toBeNull();
  });

  it('construit une URL déterministe à partir du cloud_name et du public_id', () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    expect(buildCloudinaryPublicUrl('glotta/avatar/abc')).toBe(
      'https://res.cloudinary.com/demo/image/upload/glotta/avatar/abc',
    );
  });
});
