import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AdminService } from './admin.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

// Toutes les routes ci-dessous exigent un compte ADMIN actif — voir
// AdminGuard (relit toujours role/isActive en base, jamais depuis le JWT).
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  getMetrics() {
    return this.admin.getMetrics();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id')
  updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.updateUserStatus(id, dto);
  }

  @Get('reports')
  listReports(@Query() query: ListReportsQueryDto) {
    return this.admin.listReports(query);
  }

  @Patch('reports/:id')
  resolveReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.admin.resolveReport(user.userId, id, dto);
  }
}
