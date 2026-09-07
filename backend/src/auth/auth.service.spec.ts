import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Language, User, UserSession } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LanguagesService } from '../languages/languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail/mail.service';

jest.mock('bcrypt');

const mockedBcrypt = jest.mocked(bcrypt);

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'honore',
    email: 'honore@example.com',
    phone: null,
    passwordHash: 'hashed-password',
    firstName: 'Honoré',
    lastName: 'K.',
    primaryLanguageId: 'lang-fr',
    preferredReceiveLanguageId: 'lang-fr',
    isActive: true,
    role: 'USER',
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildLanguage(overrides: Partial<Language> = {}): Language {
  return {
    id: 'lang-fr',
    code: 'fr',
    name: 'Français',
    nativeName: 'Français',
    enabled: true,
    speechSupported: false,
    translationSupported: false,
    voiceSupported: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: '',
    previousRefreshTokenHash: null,
    userAgent: null,
    ipAddress: null,
    deviceLabel: null,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    revokedAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    userSession: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    passwordResetToken: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let languages: { findEnabledByCode: jest.Mock };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let config: { get: jest.Mock; getOrThrow: jest.Mock };
  let mail: { sendPasswordReset: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      userSession: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      passwordResetToken: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    languages = { findEnabledByCode: jest.fn() };
    jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
    config = {
      get: jest.fn((key: string) => (key === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : undefined)),
      getOrThrow: jest.fn((key: string) => `secret-${key}`),
    };
    mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    jwt.signAsync.mockResolvedValue('signed-token');
    mockedBcrypt.hash.mockResolvedValue('hashed-value' as never);

    service = new AuthService(
      prisma as unknown as PrismaService,
      languages as unknown as LanguagesService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      mail as unknown as MailService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('rejette une inscription sans email ni téléphone', async () => {
      await expect(
        service.register(
          {
            firstName: 'Honoré',
            lastName: 'K.',
            username: 'honore',
            password: 'un-mot-de-passe-solide',
            primaryLanguageCode: 'fr',
          },
          {},
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuse un nom d'utilisateur déjà pris", async () => {
      prisma.user.findUnique.mockResolvedValueOnce(buildUser()); // username lookup

      await expect(
        service.register(
          {
            firstName: 'Honoré',
            lastName: 'K.',
            username: 'honore',
            email: 'autre@example.com',
            password: 'un-mot-de-passe-solide',
            primaryLanguageCode: 'fr',
          },
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('crée le compte et renvoie des tokens quand tout est valide', async () => {
      prisma.user.findUnique.mockResolvedValue(null); // username/email libres
      languages.findEnabledByCode.mockResolvedValue(buildLanguage());
      const createdUser = buildUser();
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.userSession.create.mockResolvedValue(buildSession());
      prisma.userSession.update.mockResolvedValue(buildSession());

      const result = await service.register(
        {
          firstName: 'Honoré',
          lastName: 'K.',
          username: 'honore',
          email: 'honore@example.com',
          password: 'un-mot-de-passe-solide',
          primaryLanguageCode: 'fr',
        },
        { userAgent: 'jest', ipAddress: '127.0.0.1' },
      );

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // Les matchers Jest imbriqués (`expect.objectContaining` dans un
          // objet littéral) sont typés `any` dans @types/jest — sans danger
          // ici, c'est un assert de test, pas du code applicatif.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ primaryLanguageId: 'lang-fr' }),
        }),
      );
    });

    it("se contente de nom d'utilisateur/email/mot de passe : replie firstName sur le username, lastName sur '', langue sur 'fr'", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      languages.findEnabledByCode.mockResolvedValue(buildLanguage());
      prisma.user.create.mockResolvedValue(buildUser());
      prisma.userSession.create.mockResolvedValue(buildSession());
      prisma.userSession.update.mockResolvedValue(buildSession());

      await service.register(
        { username: 'honore', email: 'honore@example.com', password: 'un-mot-de-passe-solide' },
        {},
      );

      expect(languages.findEnabledByCode).toHaveBeenCalledWith('fr');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ firstName: 'honore', lastName: '' }),
        }),
      );
    });
  });

  describe('refresh', () => {
    // Convention de ce bloc : mockedBcrypt.compare(token, hash) renvoie vrai
    // seulement si hash === `hash-of-${token}` — permet de simuler avec
    // précision quel hash correspond à quel token en clair sans vrai bcrypt.
    beforeEach(() => {
      // Casté vers un type de mock non surchargé : la signature "callback"
      // de bcrypt.compare (renvoie void) fait sinon gagner la mauvaise
      // surcharge lors de l'inférence de mockImplementation.
      (
        mockedBcrypt.compare as unknown as jest.Mock<Promise<boolean>, [string, string]>
      ).mockImplementation((token, hash) => Promise.resolve(hash === `hash-of-${token}`));
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', sessionId: 'session-1' });
    });

    it('accepte le refresh token courant normalement', async () => {
      const session = buildSession({ refreshTokenHash: 'hash-of-current-token' });
      prisma.userSession.findUnique.mockResolvedValue(session);
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.userSession.update.mockResolvedValue(session);

      const result = await service.refresh('current-token');

      expect(result.accessToken).toBe('signed-token');
      expect(prisma.userSession.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it(
      'accepte encore le précédent refresh token dans la fenêtre de grâce (deux onglets qui ' +
        'rafraîchissent quasi simultanément avec le même token de départ), sans révoquer la session',
      async () => {
        // Simule le "perdant" de la course : un autre appel a déjà fait
        // tourner le hash vers "new-token", mais celui-ci présente encore
        // l'ancien, tout juste supplanté (rotation il y a un instant).
        const session = buildSession({
          refreshTokenHash: 'hash-of-new-token',
          previousRefreshTokenHash: 'hash-of-old-token',
          lastUsedAt: new Date(),
        });
        prisma.userSession.findUnique.mockResolvedValue(session);
        prisma.user.findUnique.mockResolvedValue(buildUser());
        prisma.userSession.update.mockResolvedValue(session);

        const result = await service.refresh('old-token');

        expect(result.accessToken).toBe('signed-token');
        expect(prisma.userSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            data: expect.objectContaining({ revokedAt: expect.any(Date) }),
          }),
        );
      },
    );

    it('révoque la session si le token présenté est plus ancien que le précédent immédiat (vrai rejeu)', async () => {
      const session = buildSession({
        refreshTokenHash: 'hash-of-new-token',
        previousRefreshTokenHash: 'hash-of-old-token',
        lastUsedAt: new Date(),
      });
      prisma.userSession.findUnique.mockResolvedValue(session);

      await expect(service.refresh('really-old-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: session.id },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('révoque la session si la fenêtre de grâce est dépassée, même pour le précédent immédiat', async () => {
      const session = buildSession({
        refreshTokenHash: 'hash-of-new-token',
        previousRefreshTokenHash: 'hash-of-old-token',
        lastUsedAt: new Date(Date.now() - 61_000), // > REFRESH_GRACE_PERIOD_MS (60s)
      });
      prisma.userSession.findUnique.mockResolvedValue(session);

      await expect(service.refresh('old-token')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: session.id },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('rejette une session déjà révoquée', async () => {
      prisma.userSession.findUnique.mockResolvedValue(buildSession({ revokedAt: new Date() }));

      await expect(service.refresh('peu-importe')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('rejette un mot de passe incorrect sans révéler la cause précise', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.login({ identifier: 'honore', password: 'faux' }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejette un identifiant inconnu avec le même message que l'échec de mot de passe", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ identifier: 'inconnu', password: 'peu-importe' }, {}),
      ).rejects.toThrow('Identifiants invalides.');
    });

    it('connecte et renvoie des tokens quand les identifiants sont valides', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockedBcrypt.compare.mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue(buildSession());
      prisma.userSession.update.mockResolvedValue(buildSession());

      const result = await service.login({ identifier: 'honore', password: 'bon-mdp' }, {});

      expect(result.accessToken).toBe('signed-token');
      expect(result.user.id).toBe('user-1');
    });
  });

  describe('changePassword', () => {
    it('rejette si le mot de passe actuel est incorrect', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser());
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.changePassword('user-1', 'session-1', {
          currentPassword: 'faux',
          newPassword: 'nouveau-mot-de-passe',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('met à jour le mot de passe et révoque les autres sessions', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser());
      mockedBcrypt.compare.mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(buildUser());
      prisma.userSession.updateMany.mockResolvedValue({ count: 1 });

      await service.changePassword('user-1', 'session-1', {
        currentPassword: 'bon-mdp',
        newPassword: 'nouveau-mot-de-passe',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: expect.objectContaining({ userId: 'user-1', id: { not: 'session-1' } }),
        }),
      );
    });
  });

  describe('revokeSession', () => {
    it("refuse de révoquer la session d'un autre utilisateur", async () => {
      prisma.userSession.findUnique.mockResolvedValue(buildSession({ userId: 'autre-user' }));

      await expect(service.revokeSession('user-1', 'session-1')).rejects.toThrow(
        'Session introuvable.',
      );
      expect(prisma.userSession.update).not.toHaveBeenCalled();
    });
  });
});
