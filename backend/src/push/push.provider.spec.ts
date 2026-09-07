import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider } from './push.provider';

// web-push exporte ses fonctions avec des propriétés non reconfigurables —
// jest.spyOn sur le module réel échoue ("Cannot redefine property"),
// contrairement au SDK Cloudinary (objet mutable classique). jest.mock()
// remplace chaque export par un jest.fn() automatique.
jest.mock('web-push');
const mockedSendNotification = webpush.sendNotification as jest.Mock;

const ENV_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

function buildSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    endpoint: 'https://push.example.com/abc',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    userAgent: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PushProvider', () => {
  let originalEnv: Record<string, string | undefined>;
  let prisma: {
    pushSubscription: { findMany: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    prisma = {
      pushSubscription: { findMany: jest.fn(), deleteMany: jest.fn() },
    };
    mockedSendNotification.mockReset();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('renvoie false sans les 3 variables VAPID', () => {
      expect(new PushProvider(prisma as unknown as PrismaService).isConfigured()).toBe(false);
    });

    it('renvoie false si une seule des 3 variables manque', () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      // VAPID_SUBJECT absent
      expect(new PushProvider(prisma as unknown as PrismaService).isConfigured()).toBe(false);
    });

    it('renvoie true avec les 3 variables présentes', () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      expect(new PushProvider(prisma as unknown as PrismaService).isConfigured()).toBe(true);
    });
  });

  describe('getPublicKey', () => {
    it('renvoie null sans VAPID_PUBLIC_KEY', () => {
      expect(new PushProvider(prisma as unknown as PrismaService).getPublicKey()).toBeNull();
    });

    it('renvoie la clé publique quand configurée', () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      expect(new PushProvider(prisma as unknown as PrismaService).getPublicKey()).toBe('pub');
    });
  });

  describe('sendToUser', () => {
    it("ne fait rien (jamais d'appel réseau) si non configuré", async () => {
      const sendSpy = mockedSendNotification;
      const provider = new PushProvider(prisma as unknown as PrismaService);

      await provider.sendToUser('user-1', { title: 't', body: 'b', url: '/chat' });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it("ne fait rien si l'utilisateur n'a aucun abonnement", async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      const sendSpy = mockedSendNotification;
      const provider = new PushProvider(prisma as unknown as PrismaService);

      await provider.sendToUser('user-1', { title: 't', body: 'b', url: '/chat' });

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("envoie vers chaque abonnement de l'utilisateur avec le payload JSON attendu", async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      prisma.pushSubscription.findMany.mockResolvedValue([
        buildSubscription({ id: 'sub-1', endpoint: 'https://push.example.com/a' }),
        buildSubscription({ id: 'sub-2', endpoint: 'https://push.example.com/b' }),
      ]);
      const sendSpy = mockedSendNotification.mockResolvedValue({});
      const provider = new PushProvider(prisma as unknown as PrismaService);

      await provider.sendToUser('user-1', { title: 'Titre', body: 'Corps', url: '/chat?c=1' });

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://push.example.com/a' }),
        JSON.stringify({ title: 'Titre', body: 'Corps', url: '/chat?c=1' }),
      );
    });

    it('supprime silencieusement un abonnement expiré (404/410), sans lever', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      prisma.pushSubscription.findMany.mockResolvedValue([buildSubscription()]);
      mockedSendNotification.mockRejectedValue({ statusCode: 410 });
      const provider = new PushProvider(prisma as unknown as PrismaService);

      await expect(
        provider.sendToUser('user-1', { title: 't', body: 'b', url: '/chat' }),
      ).resolves.toBeUndefined();

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example.com/abc' },
      });
    });

    it('une erreur réseau autre que 404/410 est loguée mais ne remonte jamais (best-effort)', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:a@b.com';
      prisma.pushSubscription.findMany.mockResolvedValue([buildSubscription()]);
      mockedSendNotification.mockRejectedValue(new Error('panne réseau'));
      const provider = new PushProvider(prisma as unknown as PrismaService);

      await expect(
        provider.sendToUser('user-1', { title: 't', body: 'b', url: '/chat' }),
      ).resolves.toBeUndefined();

      expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
    });
  });
});
