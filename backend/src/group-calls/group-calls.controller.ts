import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { GroupCallsService } from './group-calls.service';

@ApiTags('group-calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('group-calls')
export class GroupCallsController {
  constructor(private readonly groupCalls: GroupCallsService) {}

  /** Hydratation à la demande d'un message GROUP_CALL chargé depuis l'historique — même principe et même limite que GET /calls/message/:messageId. */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('message/:messageId')
  getByMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.groupCalls.getByMessageId(user.userId, messageId);
  }
}
