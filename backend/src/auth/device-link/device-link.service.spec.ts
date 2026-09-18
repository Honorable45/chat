import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DeviceLinkGateway } from './device-link.gateway';
import { DeviceLinkService } from './device-link.service';

jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    tokenHash: 'hash-of-the-token',
    status: 'PENDING',
    browserName: 'Chrome',
    operatingSystem: 'macOS',
    ipAddress: null,
    userId: null,
    confirmedAt: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'honore',
    firstName: 'Honoré',
    lastName: 'K.',
    email: 'honore@example.com',
    phone: null,
    ...overrides,
  };
}

describe('DeviceLinkService.confirm', () => {
  let prisma: {
    webLinkRequest: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let auth: { createSession: jest.Mock };
  let gateway: { emitConfirmed: jest.Mock; emitCancelled: jest.Mock };
  let service: DeviceLinkService;

  beforeEach(() => {
    prisma = {
      webLinkRequest: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      user: { findUniqueOrThrow: jest.fn() },
    };
    auth = { createSession: jest.fn() };
    gateway = { emitConfirmed: jest.fn(), emitCancelled: jest.fn() };
    service = new DeviceLinkService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService,
      gateway as unknown as DeviceLinkGateway,
    );
    (
      mockedBcrypt.compare as unknown as jest.Mock<Promise<boolean>, [string, string]>
    ).mockImplementation((token, hash) =>
      Promise.resolve(hash === 'hash-of-the-token' && token === 'le-token'),
    );
  });

  it('crée une session et confirme la demande quand elle est bien PENDING', async () => {
    prisma.webLinkRequest.findMany.mockResolvedValue([buildRequest()]);
    prisma.webLinkRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser());
    auth.createSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    await service.confirm('user-1', 'le-token', 'confirm', undefined, {});

    expect(prisma.webLinkRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'link-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'CONFIRMED', userId: 'user-1' }) as unknown,
    });
    expect(auth.createSession).toHaveBeenCalled();
    expect(gateway.emitConfirmed).toHaveBeenCalledWith(
      'link-1',
      expect.objectContaining({ accessToken: 'a', refreshToken: 'r' }),
    );
  });

  it(
    'deux confirmations concurrentes sur le même token : une seule crée une session, ' +
      "l'autre est rejetée sans effet de bord",
    async () => {
      prisma.webLinkRequest.findMany.mockResolvedValue([buildRequest()]);
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser());
      auth.createSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
      // Simule l'ordre d'arrivée des écritures : le premier appel à
      // atteindre la base gagne (count: 1), le second trouve déjà CONFIRMED.
      prisma.webLinkRequest.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const [first, second] = await Promise.allSettled([
        service.confirm('user-1', 'le-token', 'confirm', undefined, {}),
        service.confirm('user-1', 'le-token', 'confirm', undefined, {}),
      ]);

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      if (second.status === 'rejected') {
        expect(second.reason).toBeInstanceOf(NotFoundException);
      }
      expect(auth.createSession).toHaveBeenCalledTimes(1);
      expect(gateway.emitConfirmed).toHaveBeenCalledTimes(1);
    },
  );

  it('rejette une confirmation si la demande a déjà été traitée (statut plus PENDING)', async () => {
    prisma.webLinkRequest.findMany.mockResolvedValue([buildRequest()]);
    prisma.webLinkRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.confirm('user-1', 'le-token', 'confirm', undefined, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auth.createSession).not.toHaveBeenCalled();
    expect(gateway.emitConfirmed).not.toHaveBeenCalled();
  });

  it('annule sans jamais créer de session', async () => {
    prisma.webLinkRequest.findMany.mockResolvedValue([buildRequest()]);
    prisma.webLinkRequest.updateMany.mockResolvedValue({ count: 1 });

    await service.confirm('user-1', 'le-token', 'cancel', undefined, {});

    expect(prisma.webLinkRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'link-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(auth.createSession).not.toHaveBeenCalled();
    expect(gateway.emitCancelled).toHaveBeenCalledWith('link-1');
  });
});
