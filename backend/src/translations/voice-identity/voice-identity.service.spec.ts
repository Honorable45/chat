import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VoiceIdentityService } from './voice-identity.service';

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    avatarUrl: null,
    avatarStorageKey: null,
    statusText: null,
    voiceCloningConsent: false,
    voiceCloningUpdatedAt: null,
    voiceModelId: null,
    showLastSeen: true,
    showOnlineStatus: true,
    showReadReceipts: true,
    whoCanMessageMe: 'EVERYONE',
    whoCanSeeMyStatus: 'EVERYONE',
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Signature WAV réelle minimale ("RIFF"...."WAVE") — depuis l'audit de
// sécurité, VoiceIdentityService vérifie les octets du fichier en plus du
// Content-Type déclaré (voir file-signature.util.ts), un buffer de
// remplissage seul ne suffit donc plus à passer la validation.
const WAV_SIGNATURE = Buffer.from('RIFF\0\0\0\0WAVE', 'latin1');

function buildSample(): Express.Multer.File {
  return {
    fieldname: 'sample',
    originalname: 'sample.wav',
    encoding: '7bit',
    mimetype: 'audio/wav',
    size: 2000,
    buffer: Buffer.concat([WAV_SIGNATURE, Buffer.alloc(2000 - WAV_SIGNATURE.length, 1)]),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  };
}

describe('VoiceIdentityService', () => {
  let prisma: { profile: { findUnique: jest.Mock; update: jest.Mock } };
  let fetchMock: jest.Mock;
  let service: VoiceIdentityService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    prisma = { profile: { findUnique: jest.fn(), update: jest.fn() } };
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    service = new VoiceIdentityService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveVoiceReference', () => {
    it('ne renvoie rien sans consentement, même avec un modèle déjà inscrit', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ voiceCloningConsent: false, voiceModelId: 'voice-123' }),
      );

      const result = await service.resolveVoiceReference('user-1');

      expect(result).toBeNull();
    });

    it('ne renvoie rien avec consentement mais sans modèle inscrit', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ voiceCloningConsent: true, voiceModelId: null }),
      );

      const result = await service.resolveVoiceReference('user-1');

      expect(result).toBeNull();
    });

    it('renvoie la référence uniquement si consentement ET modèle sont réunis', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ voiceCloningConsent: true, voiceModelId: 'voice-123' }),
      );

      const result = await service.resolveVoiceReference('user-1');

      expect(result).toEqual({ voiceModelId: 'voice-123' });
    });
  });

  describe('enroll', () => {
    it('refuse si TTS_PROVIDER n\'est pas "elevenlabs"', async () => {
      process.env.TTS_PROVIDER = 'none';

      await expect(service.enroll('user-1', buildSample())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuse sans TTS_API_KEY', async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      delete process.env.TTS_API_KEY;

      await expect(service.enroll('user-1', buildSample())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('refuse sans fichier', async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      process.env.TTS_API_KEY = 'key';

      await expect(service.enroll('user-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un format audio non supporté', async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      process.env.TTS_API_KEY = 'key';

      await expect(
        service.enroll('user-1', { ...buildSample(), mimetype: 'video/mp4' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse sans consentement au clonage déjà actif', async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      process.env.TTS_API_KEY = 'key';
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ voiceCloningConsent: false }));

      await expect(service.enroll('user-1', buildSample())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('inscrit le nouveau modèle et met à jour le profil', async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      process.env.TTS_API_KEY = 'key';
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ voiceCloningConsent: true, voiceModelId: null }),
      );
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-id' }),
      });

      const result = await service.enroll('user-1', buildSample());

      expect(result).toEqual({ voiceModelId: 'new-voice-id' });
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { voiceModelId: 'new-voice-id' },
      });
    });

    it("supprime l'ancien modèle chez le fournisseur en remplaçant un modèle existant", async () => {
      process.env.TTS_PROVIDER = 'elevenlabs';
      process.env.TTS_API_KEY = 'key';
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ voiceCloningConsent: true, voiceModelId: 'old-voice-id' }),
      );
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ voice_id: 'new-voice-id' }),
        })
        .mockResolvedValueOnce({ ok: true });

      await service.enroll('user-1', buildSample());

      const calls = fetchMock.mock.calls as [string, RequestInit][];
      const deleteCall = calls.find(([url]) => url.includes('old-voice-id'));
      expect(deleteCall?.[1]).toMatchObject({ method: 'DELETE' });
    });
  });

  describe('removeModel', () => {
    it("ne fait rien si aucun modèle n'est inscrit (idempotent)", async () => {
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ voiceModelId: null }));

      await service.removeModel('user-1');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.profile.update).not.toHaveBeenCalled();
    });

    it('supprime le modèle chez le fournisseur puis en base', async () => {
      process.env.TTS_API_KEY = 'key';
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ voiceModelId: 'voice-123' }));
      fetchMock.mockResolvedValue({ ok: true });

      await service.removeModel('user-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/voice-123',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { voiceModelId: null },
      });
    });

    it('supprime quand même en base si le fournisseur est injoignable (best-effort)', async () => {
      process.env.TTS_API_KEY = 'key';
      prisma.profile.findUnique.mockResolvedValue(buildProfile({ voiceModelId: 'voice-123' }));
      fetchMock.mockRejectedValue(new Error('network down'));

      await service.removeModel('user-1');

      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { voiceModelId: null },
      });
    });
  });
});
