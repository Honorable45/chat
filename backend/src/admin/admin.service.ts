import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessagesService } from '../messages/messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatusesService } from '../statuses/statuses.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

const DEFAULT_PAGE_SIZE = 30;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminMetrics {
  users: { total: number; active: number };
  messagesSent: { total: number; last7Days: number };
  calls: { total: number };
  activeStatuses: number;
  reports: { pending: number };
}

export interface AdminUserSummary {
  id: string;
  username: string;
  email: string | null;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly statuses: StatusesService,
  ) {}

  /**
   * Premiers `count()` agrégés de ce projet (jusqu'ici, jamais eu besoin
   * d'une vue d'ensemble — chaque endpoint existant renvoie des données
   * scopées à un utilisateur ou une conversation). Rien d'exotique : des
   * comptages Prisma standards, en parallèle.
   */
  async getMetrics(): Promise<AdminMetrics> {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
    const [
      usersTotal,
      usersActive,
      messagesTotal,
      messagesLast7Days,
      callsTotal,
      activeStatuses,
      reportsPending,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.message.count(),
      this.prisma.message.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.call.count(),
      this.prisma.status.count({ where: { expiresAt: { gt: new Date() } } }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      users: { total: usersTotal, active: usersActive },
      messagesSent: { total: messagesTotal, last7Days: messagesLast7Days },
      calls: { total: callsTotal },
      activeStatuses,
      reports: { pending: reportsPending },
    };
  }

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ items: AdminUserSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.UserWhereInput = query.q
      ? {
          OR: [
            { username: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  async updateUserStatus(userId: string, dto: UpdateUserStatusDto): Promise<AdminUserSummary> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Utilisateur introuvable.');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: dto.isActive },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }

  async listReports(query: ListReportsQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.prisma.report.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        reporter: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map((report) => this.withTargetPreview(report)));

    return { items, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  async resolveReport(adminId: string, reportId: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Signalement introuvable.');
    if (report.status !== 'PENDING') {
      throw new BadRequestException('Ce signalement a déjà été traité.');
    }

    if (dto.action === 'REMOVE_CONTENT') {
      if (report.targetType === 'MESSAGE') {
        await this.messages.removeAsAdmin(report.targetId);
      } else if (report.targetType === 'STATUS') {
        await this.statuses.removeAsAdmin(report.targetId);
      } else {
        throw new BadRequestException(
          "Suppression impossible pour un signalement d'utilisateur — désactivez plutôt le compte.",
        );
      }
    }

    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.action === 'REMOVE_CONTENT' ? 'RESOLVED' : 'DISMISSED',
        resolvedAt: new Date(),
        resolvedById: adminId,
      },
      include: {
        reporter: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
    });
  }

  /** Aperçu au moment de la consultation — `null` si la cible a été supprimée entre-temps (voir Report, polymorphe par design). */
  private async withTargetPreview<T extends { targetType: string; targetId: string }>(
    report: T,
  ): Promise<T & { targetPreview: string | null }> {
    const targetPreview =
      report.targetType === 'MESSAGE'
        ? ((
            await this.prisma.message.findUnique({
              where: { id: report.targetId },
              select: { text: true, deletedAt: true },
            })
          )?.text ?? null)
        : report.targetType === 'STATUS'
          ? ((
              await this.prisma.status.findUnique({
                where: { id: report.targetId },
                select: { text: true },
              })
            )?.text ?? null)
          : ((
              await this.prisma.user.findUnique({
                where: { id: report.targetId },
                select: { username: true },
              })
            )?.username ?? null);

    return { ...report, targetPreview };
  }
}
