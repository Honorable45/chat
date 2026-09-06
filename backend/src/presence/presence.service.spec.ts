import type { Profile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../websocket/events.gateway';
import { PresenceService } from './presence.service';

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    avatarUrl: null,
    avatarStorageKey: null,
    avatarStorageProvider: 'LOCAL',
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

describe('PresenceService', () => {
  let prisma: {
    profile: { findUnique: jest.Mock };
    user: { update: jest.Mock; findUnique: jest.Mock };
    conversationMember: { findMany: jest.Mock };
  };
  let events: { emitToUsers: jest.Mock };
  let service: PresenceService;

  beforeEach(() => {
    prisma = {
      profile: { findUnique: jest.fn().mockResolvedValue(buildProfile()) },
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ lastSeenAt: null }),
      },
      conversationMember: { findMany: jest.fn().mockResolvedValue([]) },
    };
    events = { emitToUsers: jest.fn() };
    service = new PresenceService(
      prisma as unknown as PrismaService,
      events as unknown as EventsGateway,
    );
  });

  it('marque en ligne à la première connexion et le reflète dans isOnline', async () => {
    expect(service.isOnline('user-1')).toBe(false);
    await service.handleSocketConnected('user-1', 'socket-a');
    expect(service.isOnline('user-1')).toBe(true);
  });

  it('ne rediffuse pas "en ligne" pour un deuxième appareil déjà connecté', async () => {
    prisma.conversationMember.findMany.mockResolvedValue([{ conversationId: 'conv-1' }]);
    await service.handleSocketConnected('user-1', 'socket-a');
    events.emitToUsers.mockClear();

    await service.handleSocketConnected('user-1', 'socket-b');

    expect(events.emitToUsers).not.toHaveBeenCalled();
    expect(service.isOnline('user-1')).toBe(true);
  });

  it("reste en ligne tant qu'un autre appareil est connecté après une déconnexion", async () => {
    await service.handleSocketConnected('user-1', 'socket-a');
    await service.handleSocketConnected('user-1', 'socket-b');

    await service.handleSocketDisconnected('user-1', 'socket-a');

    expect(service.isOnline('user-1')).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('passe hors ligne et horodate lastSeenAt à la dernière déconnexion', async () => {
    await service.handleSocketConnected('user-1', 'socket-a');

    await service.handleSocketDisconnected('user-1', 'socket-a');

    expect(service.isOnline('user-1')).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  describe('getPresence', () => {
    it('masque isOnline/lastSeenAt selon les réglages de confidentialité par défaut', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ showOnlineStatus: false, showLastSeen: false }),
      );
      prisma.user.findUnique.mockResolvedValue({ lastSeenAt: new Date() });
      await service.handleSocketConnected('user-1', 'socket-a');

      const presence = await service.getPresence('user-1');

      expect(presence.isOnline).toBe(false);
      expect(presence.lastSeenAt).toBeNull();
    });

    it('ne masque jamais rien quand respectPrivacy=false (vue "moi-même")', async () => {
      prisma.profile.findUnique.mockResolvedValue(
        buildProfile({ showOnlineStatus: false, showLastSeen: false }),
      );
      const lastSeen = new Date();
      prisma.user.findUnique.mockResolvedValue({ lastSeenAt: lastSeen });
      await service.handleSocketConnected('user-1', 'socket-a');

      const presence = await service.getPresence('user-1', false);

      expect(presence.isOnline).toBe(true);
      expect(presence.lastSeenAt).toEqual(lastSeen);
    });
  });

  it("n'échoue jamais (ni ne plante) si la base est indisponible pendant la diffusion", async () => {
    prisma.conversationMember.findMany.mockRejectedValue(new Error('DatabaseNotReachable'));

    await expect(service.handleSocketConnected('user-1', 'socket-a')).resolves.toBeUndefined();
    // L'état en mémoire reste correct malgré l'échec de diffusion.
    expect(service.isOnline('user-1')).toBe(true);
  });
});
