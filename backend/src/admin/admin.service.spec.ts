import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MessagesService } from '../messages/messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatusesService } from '../statuses/statuses.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let prisma: {
    user: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    message: { count: jest.Mock; findUnique: jest.Mock };
    call: { count: jest.Mock };
    status: { count: jest.Mock; findUnique: jest.Mock };
    report: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let messages: { removeAsAdmin: jest.Mock };
  let statuses: { removeAsAdmin: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      user: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      message: { count: jest.fn(), findUnique: jest.fn() },
      call: { count: jest.fn() },
      status: { count: jest.fn(), findUnique: jest.fn() },
      report: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    messages = { removeAsAdmin: jest.fn().mockResolvedValue(undefined) };
    statuses = { removeAsAdmin: jest.fn().mockResolvedValue(undefined) };
    service = new AdminService(
      prisma as unknown as PrismaService,
      messages as unknown as MessagesService,
      statuses as unknown as StatusesService,
    );
  });

  describe('getMetrics', () => {
    it('agrège les comptes de chaque ressource', async () => {
      prisma.user.count.mockResolvedValueOnce(100).mockResolvedValueOnce(90);
      prisma.message.count.mockResolvedValueOnce(500).mockResolvedValueOnce(42);
      prisma.call.count.mockResolvedValue(12);
      prisma.status.count.mockResolvedValue(7);
      prisma.report.count.mockResolvedValue(3);

      const metrics = await service.getMetrics();

      expect(metrics).toEqual({
        users: { total: 100, active: 90 },
        messagesSent: { total: 500, last7Days: 42 },
        calls: { total: 12 },
        activeStatuses: 7,
        reports: { pending: 3 },
      });
    });
  });

  describe('listUsers', () => {
    it('filtre sur username/email quand q est fourni', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listUsers({ q: 'ali' });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { username: { contains: 'ali', mode: 'insensitive' } },
              { email: { contains: 'ali', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('pagine par curseur (hasMore/nextCursor)', async () => {
      const rows = Array.from({ length: 31 }, (_, i) => ({ id: `user-${i}` }));
      prisma.user.findMany.mockResolvedValue(rows);
      const result = await service.listUsers({});
      expect(result.items).toHaveLength(30);
      expect(result.nextCursor).toBe('user-29');
    });
  });

  describe('updateUserStatus', () => {
    it('refuse un utilisateur introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateUserStatus('nope', { isActive: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('bascule isActive pour un utilisateur existant', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({ id: 'user-1', isActive: false });
      const result = await service.updateUserStatus('user-1', { isActive: false });
      expect(result.isActive).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { isActive: false } }),
      );
    });
  });

  describe('resolveReport', () => {
    it('refuse un signalement déjà traité', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'RESOLVED' });
      await expect(
        service.resolveReport('admin-1', 'report-1', { action: 'DISMISS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un signalement introuvable', async () => {
      prisma.report.findUnique.mockResolvedValue(null);
      await expect(
        service.resolveReport('admin-1', 'nope', { action: 'DISMISS' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('DISMISS ne supprime jamais le contenu, seulement le statut du signalement', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'report-1',
        status: 'PENDING',
        targetType: 'MESSAGE',
        targetId: 'msg-1',
      });
      prisma.report.update.mockResolvedValue({ id: 'report-1', status: 'DISMISSED' });

      await service.resolveReport('admin-1', 'report-1', { action: 'DISMISS' });

      expect(messages.removeAsAdmin).not.toHaveBeenCalled();
      expect(prisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ status: 'DISMISSED', resolvedById: 'admin-1' }),
        }),
      );
    });

    it('REMOVE_CONTENT sur un signalement MESSAGE appelle MessagesService.removeAsAdmin', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'report-1',
        status: 'PENDING',
        targetType: 'MESSAGE',
        targetId: 'msg-1',
      });
      prisma.report.update.mockResolvedValue({ id: 'report-1', status: 'RESOLVED' });

      await service.resolveReport('admin-1', 'report-1', { action: 'REMOVE_CONTENT' });

      expect(messages.removeAsAdmin).toHaveBeenCalledWith('msg-1');
      expect(statuses.removeAsAdmin).not.toHaveBeenCalled();
      expect(prisma.report.update).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ data: expect.objectContaining({ status: 'RESOLVED' }) }),
      );
    });

    it('REMOVE_CONTENT sur un signalement STATUS appelle StatusesService.removeAsAdmin', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'report-1',
        status: 'PENDING',
        targetType: 'STATUS',
        targetId: 'status-1',
      });
      prisma.report.update.mockResolvedValue({ id: 'report-1', status: 'RESOLVED' });

      await service.resolveReport('admin-1', 'report-1', { action: 'REMOVE_CONTENT' });

      expect(statuses.removeAsAdmin).toHaveBeenCalledWith('status-1');
      expect(messages.removeAsAdmin).not.toHaveBeenCalled();
    });

    it("REMOVE_CONTENT refuse pour un signalement USER — on désactive le compte, on ne 'supprime' pas un utilisateur", async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'report-1',
        status: 'PENDING',
        targetType: 'USER',
        targetId: 'user-9',
      });

      await expect(
        service.resolveReport('admin-1', 'report-1', { action: 'REMOVE_CONTENT' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.report.update).not.toHaveBeenCalled();
    });
  });
});
