import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';
import { ListCallsQueryDto } from './dto/list-calls-query.dto';
import { QuickRejectDto } from './dto/quick-reject.dto';

/**
 * Plus de garde au niveau du contrôleur (contrairement à avant) : le guard
 * est désormais posé route par route, comme dans PushController — la route
 * `quick-reject` ci-dessous ne peut justement pas passer par JwtAuthGuard
 * (voir son commentaire).
 */
@ApiTags('calls')
@Controller('calls')
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly gateway: CallsGateway,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('ice-servers')
  iceServers() {
    return this.calls.iceServers();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('message/:messageId')
  getByMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.calls.getByMessageId(user.userId, messageId);
  }

  /**
   * Authentifié par un jeton dédié à usage unique, jamais par JwtAuthGuard
   * (voir CallsService.quickReject) : appelée directement par le service
   * worker en réponse à l'action "Refuser" d'une notification push système
   * d'appel entrant, à un moment où aucune page n'est peut-être ouverte —
   * donc aucun accessToken de session disponible côté client (il ne vit
   * qu'en localStorage, inaccessible depuis un service worker).
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('quick-reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async quickReject(@Body() dto: QuickRejectDto) {
    const result = await this.calls.quickReject(dto.token);
    this.gateway.notifyRejected(result);
  }

  /**
   * Reprise d'un appel entrant après ouverture de l'app depuis l'action
   * "Répondre" d'une notification push système (voir CallsService.getById,
   * frontend `?incomingCall=<id>`) — déclaré après les routes littérales
   * ci-dessus (ice-servers, message/:messageId) pour ne jamais les masquer.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':callId')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('callId') callId: string) {
    return this.calls.getById(user.userId, callId);
  }
}
