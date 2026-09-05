import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard } from './admin.guard';

function buildContext(userId: string): ExecutionContext {
  const request = { user: { userId, sessionId: 'session-1' } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let guard: AdminGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new AdminGuard(prisma as unknown as PrismaService);
  });

  it('autorise un compte ADMIN actif', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', isActive: true });
    await expect(guard.canActivate(buildContext('user-1'))).resolves.toBe(true);
  });

  it('refuse un compte USER (même actif)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER', isActive: true });
    await expect(guard.canActivate(buildContext('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse un compte ADMIN désactivé — un rôle retiré/un compte coupé doit prendre effet immédiatement', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', isActive: false });
    await expect(guard.canActivate(buildContext('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse si le compte est introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(buildContext('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('relit toujours le rôle en base plutôt que de faire confiance à un état mis en cache', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', isActive: true });
    await guard.canActivate(buildContext('user-1'));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { role: true, isActive: true },
    });
  });
});
