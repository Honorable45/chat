import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CallsService } from './calls.service';
import { ListCallsQueryDto } from './dto/list-calls-query.dto';

@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get('ice-servers')
  iceServers() {
    return this.calls.iceServers();
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCallsQueryDto) {
    return this.calls.listForUser(user.userId, query.cursor, query.limit);
  }

  /**
   * Hydratation à la demande d'un message CALL chargé depuis l'historique —
   * même principe que GET /voice/:messageId. Limite par défaut (60/min,
   * voir app.module.ts) beaucoup trop basse ici : une seule conversation
   * avec plusieurs appels dans son historique déclenche déjà autant de
   * requêtes en parallèle à l'ouverture — provoquait des 429 sur des appels
   * pourtant légitimes (même bug que MessagesController.streamAttachment,
   * même remède).
   */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('message/:messageId')
  getByMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.calls.getByMessageId(user.userId, messageId);
  }
}
