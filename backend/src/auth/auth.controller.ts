import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { EventsGateway } from '../websocket/events.gateway';
import { AuthService, DeviceContext } from './auth.service';
import { REFRESH_TOKEN_COOKIE_NAME, clearAuthCookies, setAuthCookies } from './auth-cookies.util';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdoptTokensDto } from './dto/adopt-tokens.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestPhoneChangeDto } from './dto/request-phone-change.dto';
import { RequestPhoneOtpDto } from './dto/request-phone-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';
import { VerifyPhoneChangeDto } from './dto/verify-phone-change.dto';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly events: EventsGateway,
  ) {}

  // Limites plus strictes que le défaut global (section 23) : ces routes
  // sont les cibles naturelles d'un brute-force ou d'un spam d'inscription.
  // Conservées telles quelles (mot de passe) pour l'outillage/l'admin — le
  // mobile utilise désormais le parcours téléphone+OTP ci-dessous.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto, this.deviceContext(req, dto.deviceLabel));
    setAuthCookies(res, result);
    return result;
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, this.deviceContext(req, dto.deviceLabel));
    setAuthCookies(res, result);
    return result;
  }

  // --- Inscription/connexion téléphone + OTP (section 1-2) ---
  // Point d'entrée mobile recommandé : un seul champ "numéro de téléphone"
  // (voir AuthService.requestOtp) — décide elle-même inscription/connexion.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestPhoneOtpDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.phone, req.ip);
  }

  // Limite basse et par IP en plus du cooldown par numéro dans OtpService
  // (section 16 : "limitation des OTP") — chaque SMS a un coût réel.
  // Conservées pour un usage direct (ex. écran dédié "Créer un compte")
  // plutôt que la seule saisie unifiée ci-dessus.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register/request-otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestRegisterOtp(@Body() dto: RequestPhoneOtpDto, @Req() req: Request): Promise<void> {
    return this.auth.requestRegisterOtp(dto.phone, req.ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyRegisterOtp(
    @Body() dto: VerifyRegisterOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyRegisterOtp(dto, this.deviceContext(req, dto.deviceLabel));
    setAuthCookies(res, result);
    return result;
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('login/request-otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestLoginOtp(@Body() dto: RequestPhoneOtpDto, @Req() req: Request): Promise<void> {
    return this.auth.requestLoginOtp(dto.phone, req.ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyLoginOtp(
    @Body() dto: VerifyLoginOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyLoginOtp(dto, this.deviceContext(req, dto.deviceLabel));
    if (!result.requiresTwoFactor) {
      setAuthCookies(res, result);
    }
    return result;
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Le refresh token peut venir du corps (mobile, inchangé) ou du cookie
    // httpOnly scopé à cette route (web, audit de sécurité) — jamais les
    // deux ensemble en pratique, le corps prime s'il est présent.
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = dto.refreshToken ?? cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (!refreshToken) {
      throw new UnauthorizedException('Aucun refresh token fourni.');
    }
    const result = await this.auth.refresh(refreshToken);
    setAuthCookies(res, result);
    return result;
  }

  // Liaison Web par QR (section 6-9) : DeviceLinkService/DeviceLinkGateway
  // restent INCHANGÉS — les tokens continuent de transiter en clair, une
  // seule fois, par le WebSocket "/device-link" vers le navigateur qui a
  // scanné le QR (jamais via l'API REST). Ce endpoint ne fait que relayer
  // ces mêmes tokens, une fois reçus côté JS, vers des cookies httpOnly —
  // JwtAuthGuard authentifie la requête avec l'access token tout juste reçu
  // (revérifié en base comme toute requête, voir JwtStrategy), preuve
  // suffisante pour poser les cookies correspondants.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('web/adopt-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  adoptTokens(
    @Req() req: Request,
    @Body() dto: AdoptTokensDto,
    @Res({ passthrough: true }) res: Response,
  ): void {
    const header = req.headers.authorization;
    const accessToken = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
    if (!accessToken) {
      throw new UnauthorizedException('Aucun access token fourni.');
    }
    setAuthCookies(res, { accessToken, refreshToken: dto.refreshToken });
  }

  // Limite basse : évite qu'un tiers ne se serve de cet endpoint pour
  // vérifier en masse quels emails sont enregistrés, ou pour spammer une
  // boîte de réception une fois un vrai fournisseur d'email branché.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('password-reset/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<void> {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmPasswordReset(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    clearAuthCookies(res);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.userId, user.sessionId);
    clearAuthCookies(res);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user.userId, user.sessionId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.userId, user.sessionId);
  }

  // "Appareils connectés" → "Déconnecter" (section 10) : la révocation en
  // base (voir AuthService.revokeSession) est déjà l'autorité — la suite au
  // prochain refresh du token, quoi qu'il arrive au WebSocket ci-dessous —
  // mais un navigateur Web toujours connecté doit revenir à l'écran QR
  // immédiatement plutôt que d'attendre l'expiration naturelle de son access
  // token (jusqu'à JWT_ACCESS_EXPIRES_IN).
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(user.userId, sessionId);
    this.events.emitToUser(user.userId, 'session:revoked', { sessionId });
  }

  // --- Changement de numéro (section 4 : "obligatoirement une nouvelle
  // vérification OTP") — jamais via PATCH /users/me, qui n'accepte plus
  // `phone` (voir UsersService.updateMe).
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('phone/request-change')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestPhoneChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestPhoneChangeDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.requestPhoneChange(user.userId, dto.newPhone, req.ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('phone/verify-change')
  @HttpCode(HttpStatus.OK)
  verifyPhoneChange(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPhoneChangeDto) {
    return this.auth.verifyPhoneChange(user.userId, dto.newPhone, dto.code);
  }

  private deviceContext(req: Request, deviceLabel?: string): DeviceContext {
    return {
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
      deviceLabel,
    };
  }
}
