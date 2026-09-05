import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let prisma: {
    message: { findUnique: jest.Mock };
    status: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    report: { create: jest.Mock };
  };
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      message: { findUnique: jest.fn() },
      status: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      report: { create: jest.fn() },
    };
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('crée un signalement quand la cible (message) existe', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'msg-1' });
    prisma.report.create.mockResolvedValue({
      id: 'report-1',
      targetType: 'MESSAGE',
      targetId: 'msg-1',
      reason: 'Contenu inapproprié',
      status: 'PENDING',
      createdAt: new Date(),
      reporter: { id: 'user-1', username: 'alice', firstName: 'Alice', lastName: 'A.' },
    });

    const result = await service.create('user-1', {
      targetType: 'MESSAGE',
      targetId: 'msg-1',
      reason: 'Contenu inapproprié',
    });

    expect(result.status).toBe('PENDING');
    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          targetType: 'MESSAGE',
          targetId: 'msg-1',
          reason: 'Contenu inapproprié',
          reporterId: 'user-1',
        },
      }),
    );
  });

  it("refuse de signaler un message qui n'existe pas", async () => {
    prisma.message.findUnique.mockResolvedValue(null);
    await expect(
      service.create('user-1', { targetType: 'MESSAGE', targetId: 'nope', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('vérifie la bonne table selon targetType (STATUS)', async () => {
    prisma.status.findUnique.mockResolvedValue({ id: 'status-1' });
    prisma.report.create.mockResolvedValue({
      id: 'report-1',
      targetType: 'STATUS',
      targetId: 'status-1',
      reason: 'x',
      status: 'PENDING',
      createdAt: new Date(),
      reporter: { id: 'user-1', username: 'alice', firstName: 'Alice', lastName: 'A.' },
    });

    await service.create('user-1', { targetType: 'STATUS', targetId: 'status-1', reason: 'x' });

    expect(prisma.status.findUnique).toHaveBeenCalledWith({
      where: { id: 'status-1' },
      select: { id: true },
    });
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });
});
