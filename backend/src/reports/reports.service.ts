import { Injectable, NotFoundException } from '@nestjs/common';
import { Report, ReportTarget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';

export interface ReportDto {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  status: Report['status'];
  createdAt: Date;
  reporter: { id: string; username: string; firstName: string; lastName: string };
  /** Aperçu de la cible au moment de la consultation — `null` si elle a été
   * supprimée depuis le signalement (voir AdminService.listReports, seul
   * appelant de cette union avec un aperçu résolu). */
  targetPreview?: string | null;
}

function toReportDto(
  report: Report & {
    reporter: { id: string; username: string; firstName: string; lastName: string };
  },
): ReportDto {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt,
    reporter: report.reporter,
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * N'importe quel utilisateur authentifié peut signaler — validation
   * légère que la cible existe réellement (section 40 : jamais accepter un
   * signalement qui ne pointe vers rien, même si elle peut disparaître
   * ensuite entre le signalement et son traitement par un admin).
   */
  async create(reporterId: string, dto: CreateReportDto): Promise<ReportDto> {
    await this.assertTargetExists(dto.targetType, dto.targetId);

    const report = await this.prisma.report.create({
      data: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        reporterId,
      },
      include: {
        reporter: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
    });
    return toReportDto(report);
  }

  private async assertTargetExists(targetType: ReportTarget, targetId: string): Promise<void> {
    const exists = await (targetType === 'MESSAGE'
      ? this.prisma.message.findUnique({ where: { id: targetId }, select: { id: true } })
      : targetType === 'STATUS'
        ? this.prisma.status.findUnique({ where: { id: targetId }, select: { id: true } })
        : this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }));
    if (!exists) {
      throw new NotFoundException('Le contenu signalé est introuvable.');
    }
  }
}
