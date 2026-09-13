import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { PushService } from './push.service';

/**
 * `public-key` reste public (pas de guard) : nécessaire avant même la
 * connexion pour préparer un abonnement (voir PushManager.subscribe côté
 * client) — même principe que GroupInvitesController.preview.
 */
@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  getPublicKey() {
    return this.push.getPublicKey();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
    @Req() req: Request,
  ) {
    return this.push.subscribe(user.userId, dto, req.headers['user-agent'] ?? null);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Delete('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnsubscribePushDto) {
    return this.push.unsubscribe(user.userId, dto.endpoint);
  }

  // --- Notifications push mobiles (FCM) — voir FcmProvider ---
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('fcm/register')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerFcmToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterFcmTokenDto) {
    return this.push.registerFcmToken(user.sessionId, dto.token);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Delete('fcm/register')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregisterFcmToken(@CurrentUser() user: AuthenticatedUser) {
    return this.push.unregisterFcmToken(user.sessionId);
  }
}
