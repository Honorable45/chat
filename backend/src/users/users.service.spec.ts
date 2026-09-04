import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Language, Profile, User } from '@prisma/client';
import { LanguagesService } from '../languages/languages.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'honore',
    email: 'honore@example.com',
    phone: null,
    passwordHash: 'hashed',
    firstName: 'Honoré',
    lastName: 'K.',
    primaryLanguageId: 'lang-fr',
    preferredReceiveLanguageId: 'lang-fr',
    isActive: true,
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

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let languages: { findEnabledByCode: jest.Mock; findManyEnabledByCodes: jest.Mock };
  let presence: { getPresence: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    languages = { findEnabledByCode: jest.fn(), findManyEnabledByCodes: jest.fn() };
    presence = { getPresence: jest.fn().mockResolvedValue({ isOnline: false, lastSeenAt: null }) };
    service = new UsersService(
      prisma as unknown as PrismaService,
      languages as unknown as LanguagesService,
      presence as unknown as PresenceService,
    );
  });

  describe('updateMe', () => {
    it("refuse un nom d'utilisateur déjà pris par un autre compte", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'autre-user' }));

      await expect(service.updateMe('user-1', { username: 'honore' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('autorise à garder son propre username (pas de conflit avec soi-même)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 'user-1' }));
      prisma.user.update.mockResolvedValue({
        ...buildUser(),
        profile: buildProfile(),
        primaryLanguage: buildLanguage(),
        preferredReceiveLanguage: buildLanguage(),
        spokenLanguages: [],
      });

      await expect(service.updateMe('user-1', { username: 'honore' })).resolves.toBeDefined();
    });

    it('résout les codes de langue avant la mise à jour', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      languages.findEnabledByCode.mockResolvedValue(buildLanguage({ id: 'lang-en', code: 'en' }));
      prisma.user.update.mockResolvedValue({
        ...buildUser(),
        profile: buildProfile(),
        primaryLanguage: buildLanguage({ id: 'lang-en', code: 'en' }),
        preferredReceiveLanguage: null,
        spokenLanguages: [],
      });

      await service.updateMe('user-1', { primaryLanguageCode: 'en' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ primaryLanguageId: 'lang-en' }),
        }),
      );
    });
  });

  describe('getPublicProfile', () => {
    it('renvoie 404 si le compte est introuvable ou désactivé', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getPublicProfile('inconnu')).rejects.toBeInstanceOf(NotFoundException);

      prisma.user.findUnique.mockResolvedValue({
        ...buildUser({ isActive: false }),
        profile: buildProfile(),
        primaryLanguage: buildLanguage(),
        preferredReceiveLanguage: null,
        spokenLanguages: [],
      });
      await expect(service.getPublicProfile('user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne renvoie jamais email/téléphone dans la vue publique', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...buildUser(),
        profile: buildProfile(),
        primaryLanguage: buildLanguage(),
        preferredReceiveLanguage: null,
        spokenLanguages: [],
      });

      const result = await service.getPublicProfile('user-1');

      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('phone');
    });
  });

  describe('search', () => {
    it('rejette une recherche trop courte', async () => {
      await expect(service.search('a', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
