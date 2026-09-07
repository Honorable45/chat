import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ConversationsService } from './conversations.service';

/**
 * Routes publiques d'un lien d'invitation (section 7) — volontairement un
 * controller séparé de ConversationsController (gardé par JwtAuthGuard au
 * niveau classe) : l'aperçu d'un lien doit rester accessible à quelqu'un qui
 * n'a pas encore de compte/n'est pas connecté, avant de décider de rejoindre.
 */
@ApiTags('group-invites')
@Controller('group-invites')
export class GroupInvitesController {
  constructor(private readonly conversations: ConversationsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.conversations.previewInvite(token);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':token/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentUser() user: AuthenticatedUser, @Param('token') token: string) {
    return this.conversations.joinViaInvite(user.userId, token);
  }
}
