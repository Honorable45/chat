import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService, DeviceContext } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  ChangePinDto,
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  RecoveryResetPinDto,
  RecoveryVerifyPhoneDto,
  RequestRecoveryEmailDto,
  VerifyRecoveryEmailDto,
  VerifyTwoFactorDto,
} from '../dto/two-factor.dto';
import { RequestPhoneOtpDto } from '../dto/request-phone-otp.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { TwoFactorService } from './two-factor.service';

/**
 * Paramètres → Sécurité → Vérification en deux étapes (sections 3-4). Routes
 * groupées à part de AuthController pour ne pas alourdir un contrôleur déjà
 * conséquent — reste dans AuthModule (même graphe de dépendances).
 */
@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.status(user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  enable(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnableTwoFactorDto): Promise<void> {
    return this.twoFactor.enable(user.userId, dto.pin);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(@CurrentUser() user: AuthenticatedUser, @Body() dto: DisableTwoFactorDto): Promise<void> {
    return this.twoFactor.disable(user.userId, dto.pin);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('change-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePinDto): Promise<void> {
    return this.twoFactor.changePin(user.userId, dto.currentPin, dto.newPin);
  }

  // --- Email de secours (section 4) ---
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('recovery-email/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestRecoveryEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestRecoveryEmailDto,
  ): Promise<void> {
    return this.twoFactor.requestRecoveryEmail(user.userId, dto.email);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('recovery-email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyRecoveryEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyRecoveryEmailDto,
  ): Promise<void> {
    return this.twoFactor.verifyRecoveryEmail(user.userId, dto.code);
  }

  // --- Connexion : étape PIN (section 3) ---
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() dto: VerifyTwoFactorDto, @Req() req: Request) {
    return this.auth.verifyTwoFactorPin(
      dto.phone,
      dto.continuationToken,
      dto.pin,
      dto.deviceLabel,
      this.deviceContext(req),
    );
  }

  // --- PIN oublié (section 4) : numéro → email de secours → nouveau PIN ---
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('recovery/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  recoveryRequest(@Body() dto: RequestPhoneOtpDto, @Req() req: Request): Promise<void> {
    return this.twoFactor.recoveryRequest(dto.phone, req.ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('recovery/verify-phone')
  @HttpCode(HttpStatus.OK)
  recoveryVerifyPhone(@Body() dto: RecoveryVerifyPhoneDto) {
    return this.twoFactor.recoveryVerifyPhone(dto.phone, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('recovery/reset-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  recoveryResetPin(@Body() dto: RecoveryResetPinDto): Promise<void> {
    return this.twoFactor.recoveryResetPin(
      dto.phone,
      dto.continuationToken,
      dto.emailCode,
      dto.newPin,
    );
  }

  private deviceContext(req: Request): DeviceContext {
    return { userAgent: req.get('user-agent'), ipAddress: req.ip };
  }
}
