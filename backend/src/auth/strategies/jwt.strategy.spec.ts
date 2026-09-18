import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { isActive: true },
    ...overrides,
  };
}

describe('JwtStrategy', () => {
  let prisma: { userSession: { findUnique: jest.Mock } };
  let config: { getOrThrow: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma = { userSession: { findUnique: jest.fn() } };
    config = { getOrThrow: jest.fn(() => 'secret') };
    strategy = new JwtStrategy(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  const payload = { sub: 'user-1', sessionId: 'session-1' };

  it('accepte un payload dont la session est active et le compte actif', async () => {
    prisma.userSession.findUnique.mockResolvedValue(buildSession());
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('rejette si la session est introuvable (ex. après logout/révocation)', async () => {
    prisma.userSession.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejette si la session appartient à un autre utilisateur que celui du token', async () => {
    prisma.userSession.findUnique.mockResolvedValue(buildSession({ userId: 'user-2' }));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejette si la session a été révoquée', async () => {
    prisma.userSession.findUnique.mockResolvedValue(buildSession({ revokedAt: new Date() }));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejette si la session est expirée', async () => {
    prisma.userSession.findUnique.mockResolvedValue(
      buildSession({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejette si le compte utilisateur est désactivé', async () => {
    prisma.userSession.findUnique.mockResolvedValue(buildSession({ user: { isActive: false } }));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
