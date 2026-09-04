import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PasswordResetToken, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { LanguagesService } from '../languages/languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { MailService } from './mail/mail.service';

const ACCESS_TOKEN_TTL_FALLBACK = '15m';
const REFRESH_TOKEN_TTL_FALLBACK = '30d';
const PASSWORD_SALT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h
const PASSWORD_RESET_CANDIDATES_LIMIT = 500;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SafeUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface DeviceContext {
  userAgent?: string;
  ipAddress?: string;
  deviceLabel?: string;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguagesService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto, context: DeviceContext) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Un email ou un numéro de téléphone est requis.');
    }

    const [usernameTaken, emailTaken, phoneTaken] = await Promise.all([
      this.prisma.user.findUnique({ where: { username: dto.username } }),
      dto.email ? this.prisma.user.findUnique({ where: { email: dto.email } }) : null,
      dto.phone ? this.prisma.user.findUnique({ where: { phone: dto.phone } }) : null,
    ]);
    if (usernameTaken) throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
    if (emailTaken) throw new ConflictException('Cet email est déjà utilisé.');
    if (phoneTaken) throw new ConflictException('Ce numéro est déjà utilisé.');

    const primaryLanguage = await this.languages.findEnabledByCode(dto.primaryLanguageCode);
    const preferredLanguage = dto.preferredReceiveLanguageCode
      ? await this.languages.findEnabledByCode(dto.preferredReceiveLanguageCode)
      : primaryLanguage;

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        primaryLanguageId: primaryLanguage.id,
        preferredReceiveLanguageId: preferredLanguage.id,
        profile: { create: {} },
      },
    });

    const tokens = await this.createSession(user, context);
    return { user: toSafeUser(user), ...tokens };
  }

  async login(dto: LoginDto, context: DeviceContext) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.identifier }, { email: dto.identifier }, { phone: dto.identifier }],
      },
    });

    // Même message dans les deux cas : ne pas révéler si l'identifiant existe
    // (protection contre l'énumération de comptes, section 23).
    const invalidCredentials = new UnauthorizedException('Identifiants invalides.');
    if (!user || !user.isActive) throw invalidCredentials;

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw invalidCredentials;

    const tokens = await this.createSession(user, context);
    return { user: toSafeUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    const payload = await this.verifyToken(refreshToken, this.getRefreshSecret());

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sessionId },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Session invalide ou expirée.');
    }

    const tokenMatches = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!tokenMatches) {
      // Le token présenté ne correspond pas à celui attendu pour cette
      // session : on la révoque par précaution (rejeu possible).
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session invalide ou expirée.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Compte indisponible.');

    const tokens = await this.signTokensForSession(user.id, session.id);
    return { user: toSafeUser(user), ...tokens };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string, currentSessionId?: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId?: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      isCurrent: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    // Vérification d'appartenance stricte (section 23) : jamais de révocation
    // de la session d'un autre utilisateur en devinant un ID.
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session introuvable.');
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    const passwordHash = await bcrypt.hash(dto.newPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Un changement de mot de passe révoque les autres sessions par sécurité
    // (section 23) ; la session courante reste active.
    await this.logoutAll(userId, currentSessionId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Réponse identique que le compte existe ou non (protection contre
    // l'énumération d'emails, section 23).
    if (!user) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, PASSWORD_SALT_ROUNDS);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    await this.mail.sendPasswordReset(user.email as string, rawToken);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    // Le token brut n'est jamais stocké (seul son hash l'est) : on doit donc
    // comparer contre les candidats non expirés/non utilisés plutôt que de
    // faire un lookup direct.
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: PASSWORD_RESET_CANDIDATES_LIMIT,
    });

    let matched: PasswordResetToken | null = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(rawToken, candidate.tokenHash)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) throw new UnauthorizedException('Lien de réinitialisation invalide ou expiré.');

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: matched.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: matched.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: matched.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async createSession(user: User, context: DeviceContext): Promise<AuthTokens> {
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: '', // remplacé juste après par signTokensForSession
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        deviceLabel: context.deviceLabel,
        expiresAt: this.computeRefreshExpiry(),
      },
    });
    return this.signTokensForSession(user.id, session.id);
  }

  private async signTokensForSession(userId: string, sessionId: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, sessionId };

    // expiresIn est passé en secondes (number) plutôt qu'en chaîne "15m" :
    // le typage de jsonwebtoken restreint désormais les chaînes à un format
    // littéral (`StringValue`) que nos variables d'environnement, lues comme
    // `string`, ne satisfont pas — un nombre de secondes reste accepté.
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: Math.floor(this.parseDurationMs(this.getAccessExpiresIn()) / 1000),
      }),
      this.jwt.signAsync(payload, {
        secret: this.getRefreshSecret(),
        expiresIn: Math.floor(this.parseDurationMs(this.getRefreshExpiresIn()) / 1000),
      }),
    ]);

    const refreshTokenHash = await bcrypt.hash(refreshToken, PASSWORD_SALT_ROUNDS);
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt: this.computeRefreshExpiry(),
      },
    });

    return { accessToken, refreshToken };
  }

  private async verifyToken(token: string, secret: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Session invalide ou expirée.');
    }
  }

  private getAccessExpiresIn(): string {
    return this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? ACCESS_TOKEN_TTL_FALLBACK;
  }

  private getRefreshExpiresIn(): string {
    return this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? REFRESH_TOKEN_TTL_FALLBACK;
  }

  private getRefreshSecret(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private computeRefreshExpiry(): Date {
    return new Date(Date.now() + this.parseDurationMs(this.getRefreshExpiresIn()));
  }

  private parseDurationMs(duration: string): number {
    // Suffixes s/m/h/d — suffisant pour la config JWT, pas besoin d'une
    // dépendance dédiée (type `ms`) pour ce seul usage.
    const match = /^(\d+)(s|m|h|d)$/.exec(duration);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // repli : 30 jours
    const value = Number(match[1]);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
      match[2] as 's' | 'm' | 'h' | 'd'
    ];
    return value * unitMs;
  }
}
