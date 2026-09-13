import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  ConfirmWebLinkRequestDto,
  CreateWebLinkRequestDto,
  ScanWebLinkRequestDto,
} from '../dto/device-link.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { DeviceLinkService } from './device-link.service';

/** Liaison Glotta Web par QR (sections 6-9). */
@ApiTags('auth')
@Controller('auth/web')
export class DeviceLinkController {
  constructor(private readonly deviceLink: DeviceLinkService) {}

  // Public (section 6) : le navigateur qui affiche le QR n'a par définition
  // aucune session — aucun JwtAuthGuard possible ici.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('create-link-request')
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateWebLinkRequestDto, @Req() req: Request) {
    return this.deviceLink.createLinkRequest(dto, req.ip, req.get('user-agent'));
  }

  // Authentifié mobile (section 7 : "que le mobile soit authentifié").
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('scan-link-request')
  @HttpCode(HttpStatus.OK)
  scan(@Body() dto: ScanWebLinkRequestDto) {
    return this.deviceLink.scan(dto.token);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('confirm-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmWebLinkRequestDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.deviceLink.confirm(user.userId, dto.token, dto.decision, dto.deviceLabel, {
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
  }
}
