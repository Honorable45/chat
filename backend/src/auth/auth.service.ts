import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose, SessionType, type PasswordResetToken, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { LanguagesService } from '../languages/languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { MailService } from './mail/mail.service';
import { OtpService } from './otp/otp.service';
import { hashPhone } from './phone-hash.util';

const ACCESS_TOKEN_TTL_FALLBACK = '15m';
const REFRESH_TOKEN_TTL_FALLBACK = '30d';
const PASSWORD_SALT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h
const PASSWORD_RESET_CANDIDATES_LIMIT = 500;
// Inscription simplifiée (section "juste nom d'utilisateur/email/mot de
// passe") : langue appliquée quand primaryLanguageCode est omis — l'app est
// entièrement en français par défaut, et 'fr' est toujours seedée avec
// enabled: true (voir prisma/seed.ts).
const DEFAULT_LANGUAGE_CODE = 'fr';
// Fenêtre pendant laquelle le refresh token IMMÉDIATEMENT précédent reste
// accepté après une rotation (voir refresh()) — absorbe la course bénigne
// entre deux onglets/appareils qui rafraîchissent quasi simultanément avec
// le même token de départ, sans affaiblir la détection d'un vrai rejeu
// (token plus ancien, ou hors de cette fenêtre). Réduite de 60s à 5s (audit
// de sécurité) : la course bénigne reste absorbée (deux requêtes à
// quelques centaines de ms d'écart), mais la fenêtre de rejeu exploitable
// est désormais bien plus étroite. La rotation elle-même est rendue
// atomique (voir rotateRefreshTokenAtomic) — cette fenêtre ne protège plus
// que le cas légitime de deux rotations concurrentes, jamais une
// multiplication d'un même token volé.
const REFRESH_GRACE_PERIOD_MS = 5_000;

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
  type: SessionType;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
}

export function toSafeUser(user: User): SafeUser {
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
    private readonly otp: OtpService,
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

    const primaryLanguage = await this.languages.findEnabledByCode(
      dto.primaryLanguageCode ?? DEFAULT_LANGUAGE_CODE,
    );
    const preferredLanguage = dto.preferredReceiveLanguageCode
      ? await this.languages.findEnabledByCode(dto.preferredReceiveLanguageCode)
      : primaryLanguage;

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    // firstName/lastName sont désormais optionnels à l'inscription (section
    // "juste nom d'utilisateur/email/mot de passe") : à défaut, le nom
    // d'utilisateur sert de nom affiché — modifiable ensuite depuis
    // Paramètres → Profil.
    const firstName = dto.firstName?.trim() || dto.username;
    const lastName = dto.lastName?.trim() ?? '';

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        firstName,
        lastName,
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
    // `passwordHash` est nul pour tout compte créé via le parcours
    // téléphone+OTP (voir verifyRegisterOtp) — ces comptes n'ont simplement
    // aucun mot de passe à comparer, jamais une erreur bcrypt sur `null`.
    if (!user || !user.isActive || !user.passwordHash) throw invalidCredentials;

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw invalidCredentials;

    const tokens = await this.createSession(user, context);
    return { user: toSafeUser(user), ...tokens };
  }

  /**
   * Inscription façon WhatsApp (section "1. INSCRIPTION MOBILE") : la seule
   * vérification qui compte est celle du numéro — pas de mot de passe.
   * Le nom d'utilisateur reste un concept interne à Glotta (recherche,
   * mentions, @handle affiché) : généré automatiquement plutôt que demandé,
   * modifiable ensuite depuis Paramètres → Profil (déjà supporté par
   * PATCH /users/me).
   */
  async requestRegisterOtp(phone: string, ipAddress?: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new ConflictException('Ce numéro est déjà utilisé.');
    // Bascule temporaire (voir isRegistrationOtpEnabled) : aucun SMS envoyé,
    // aucune ligne OtpRequest créée tant qu'elle est désactivée — jamais
    // supprimé, juste sauté.
    if (!this.isRegistrationOtpEnabled()) return;
    await this.otp.request(phone, OtpPurpose.REGISTER, ipAddress);
  }

  /**
   * Bascule temporaire (demande explicite, section registration) :
   * "false"/absent — jamais de SMS envoyé ni de code demandé à
   * l'inscription, le numéro est considéré vérifié tel quel pour laisser
   * l'inscription se poursuivre. "true" réactive la vérification réelle
   * exactement comme avant, sans aucun autre changement de code (le reste de
   * OtpService/SmsService/ces mêmes endpoints reste intact et inchangé).
   * Ne concerne QUE l'inscription — verifyLoginOtp/2FA gardent leur OTP
   * normal quoi qu'il arrive ici.
   */
  private isRegistrationOtpEnabled(): boolean {
    return process.env.REGISTRATION_OTP_ENABLED === 'true';
  }

  async verifyRegisterOtp(dto: VerifyRegisterOtpDto, context: DeviceContext) {
    const registrationOtpEnabled = this.isRegistrationOtpEnabled();
    if (registrationOtpEnabled && !dto.code) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    // Le code doit être réellement vérifié quand la bascule est active
    // (section 2 : "protection contre le brute-force") — laisse
    // OtpService.verify lever UnauthorizedException pour un code invalide/
    // expiré/déjà consommé, exactement comme verifyLoginOtp. Désactivée : le
    // numéro est temporairement considéré vérifié sans jamais appeler
    // OtpService (voir isRegistrationOtpEnabled).
    const otpRequest = registrationOtpEnabled
      ? await this.otp.verify(dto.phone, OtpPurpose.REGISTER, dto.code!)
      : null;

    // Revérifie l'unicité : une course est possible entre la demande d'OTP
    // et sa vérification (ex. deux appareils inscrivant le même numéro en
    // parallèle) — jamais fait confiance au seul contrôle initial.
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      if (otpRequest) await this.otp.consume(otpRequest.id);
      throw new ConflictException('Ce numéro est déjà utilisé.');
    }

    const primaryLanguage = await this.languages.findEnabledByCode(
      dto.primaryLanguageCode ?? DEFAULT_LANGUAGE_CODE,
    );
    const preferredLanguage = dto.preferredReceiveLanguageCode
      ? await this.languages.findEnabledByCode(dto.preferredReceiveLanguageCode)
      : primaryLanguage;

    const username = await this.generateUsernameFromPhone(dto.phone);
    const firstName = dto.firstName?.trim() || username;
    const lastName = dto.lastName?.trim() ?? '';

    const user = await this.prisma.user.create({
      data: {
        username,
        phone: dto.phone,
        phoneHash: hashPhone(dto.phone),
        // Réellement vérifié via l'OTP quand la bascule est active (voir
        // this.otp.verify ci-dessus) ; considéré vérifié tel quel pendant la
        // désactivation temporaire (demande explicite) — jamais `null` pour
        // un compte créé par ce parcours dans les deux cas.
        phoneVerifiedAt: new Date(),
        passwordHash: null,
        firstName,
        lastName,
        primaryLanguageId: primaryLanguage.id,
        preferredReceiveLanguageId: preferredLanguage.id,
        profile: { create: {} },
      },
    });
    if (otpRequest) await this.otp.consume(otpRequest.id);

    const tokens = await this.createSession(
      user,
      { ...context, deviceLabel: dto.deviceLabel ?? context.deviceLabel },
      SessionType.MOBILE,
    );
    return { user: toSafeUser(user), ...tokens };
  }

  /**
   * Connexion façon WhatsApp (section "2. CONNEXION MOBILE") : même réponse
   * que le compte existe ou non (voir requestPasswordReset) — jamais
   * d'énumération de comptes par numéro de téléphone.
   */
  async requestLoginOtp(phone: string, ipAddress?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive) return;
    await this.otp.request(phone, OtpPurpose.LOGIN, ipAddress);
  }

  /**
   * Point d'entrée unique côté mobile (un seul champ "numéro de téléphone",
   * façon WhatsApp) : décide elle-même s'il s'agit d'une inscription ou
   * d'une connexion et envoie l'OTP correspondant. Contrairement à
   * requestLoginOtp/requestRegisterOtp (compatibilité conservée pour un
   * usage direct), CE point d'entrée révèle nécessairement si le numéro est
   * déjà enregistré via la valeur de `purpose` — compromis assumé : sans
   * lui, le client ne pourrait pas savoir quel écran de vérification
   * afficher ensuite (profil pour une inscription, PIN 2FA éventuel pour une
   * connexion) à partir d'un unique champ de saisie.
   */
  async requestOtp(phone: string, ipAddress?: string): Promise<{ purpose: OtpPurpose }> {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (!existing.isActive) throw new UnauthorizedException('Compte indisponible.');
      // Connexion : jamais affectée par la bascule d'inscription (voir
      // isRegistrationOtpEnabled) — l'OTP de connexion reste toujours requis.
      await this.otp.request(phone, OtpPurpose.LOGIN, ipAddress);
      return { purpose: OtpPurpose.LOGIN };
    }
    // Inscription : voir isRegistrationOtpEnabled — aucun SMS envoyé tant
    // qu'elle est désactivée, `purpose` reste renvoyé normalement pour que
    // le client enchaîne sur le reste du parcours (profil...).
    if (this.isRegistrationOtpEnabled()) {
      await this.otp.request(phone, OtpPurpose.REGISTER, ipAddress);
    }
    return { purpose: OtpPurpose.REGISTER };
  }

  /**
   * Renvoie soit des tokens de session (2FA désactivée), soit
   * `{ requiresTwoFactor: true, continuationToken }` à présenter ensuite à
   * verifyTwoFactor() avec le PIN — jamais de session créée avant que le PIN
   * ne soit vérifié quand la 2FA est active (section 3).
   */
  async verifyLoginOtp(dto: VerifyLoginOtpDto, context: DeviceContext) {
    const otpRequest = await this.otp.verify(dto.phone, OtpPurpose.LOGIN, dto.code);
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user || !user.isActive) {
      // Ne devrait survenir que si le compte a été supprimé entre la demande
      // d'OTP et sa vérification (voir requestLoginOtp, qui n'envoie déjà
      // rien pour un numéro inconnu).
      throw new UnauthorizedException('Compte indisponible.');
    }

    if (user.twoFactorEnabled) {
      const continuationToken = await this.otp.issueContinuationToken(otpRequest.id);
      return { requiresTwoFactor: true as const, continuationToken };
    }

    await this.otp.consume(otpRequest.id);
    const tokens = await this.createSession(
      user,
      { ...context, deviceLabel: dto.deviceLabel ?? context.deviceLabel },
      SessionType.MOBILE,
    );
    return { requiresTwoFactor: false as const, user: toSafeUser(user), ...tokens };
  }

  /** Étape PIN de la 2FA (section 3) — voir verifyLoginOtp. */
  async verifyTwoFactorPin(
    phone: string,
    continuationToken: string,
    pin: string,
    deviceLabel: string | undefined,
    context: DeviceContext,
  ) {
    const otpRequest = await this.otp.findByContinuationToken(
      phone,
      OtpPurpose.LOGIN,
      continuationToken,
    );
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive || !user.twoFactorEnabled || !user.twoFactorPinHash) {
      throw new UnauthorizedException('Vérification en deux étapes indisponible.');
    }

    const pinValid = await bcrypt.compare(pin, user.twoFactorPinHash);
    if (!pinValid) {
      await this.otp.recordSecondFactorFailure(otpRequest.id);
      throw new UnauthorizedException('PIN incorrect.');
    }

    await this.otp.consume(otpRequest.id);
    const tokens = await this.createSession(
      user,
      { ...context, deviceLabel: deviceLabel ?? context.deviceLabel },
      SessionType.MOBILE,
    );
    return { user: toSafeUser(user), ...tokens };
  }

  /** Numéro déjà unique en base (voir schema.prisma) : la boucle ne fait
   * qu'absorber la collision statistiquement rare des 8 derniers chiffres. */
  private async generateUsernameFromPhone(phone: string): Promise<string> {
    const digits = phone.replace(/[^0-9]/g, '');
    const base = `user${digits.slice(-8)}`;
    let candidate = base;
    let suffix = 0;
    while (true) {
      const taken = await this.prisma.user.findUnique({ where: { username: candidate } });
      if (!taken) return candidate;
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
  }

  /**
   * Section 4 du cahier des charges : "un changement de numéro doit
   * obligatoirement passer par une nouvelle vérification OTP" — jamais via
   * UsersService.updateMe (qui n'accepte plus `phone`, voir son rapport).
   */
  async requestPhoneChange(userId: string, newPhone: string, ipAddress?: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { phone: newPhone } });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Ce numéro est déjà utilisé.');
    }
    await this.otp.request(newPhone, OtpPurpose.CHANGE_PHONE, ipAddress);
  }

  async verifyPhoneChange(userId: string, newPhone: string, code: string): Promise<SafeUser> {
    const otpRequest = await this.otp.verify(newPhone, OtpPurpose.CHANGE_PHONE, code);

    // Revérifie l'unicité : même raison que verifyRegisterOtp (course
    // possible entre la demande d'OTP et sa vérification).
    const existing = await this.prisma.user.findUnique({ where: { phone: newPhone } });
    if (existing && existing.id !== userId) {
      await this.otp.consume(otpRequest.id);
      throw new ConflictException('Ce numéro est déjà utilisé.');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: newPhone, phoneHash: hashPhone(newPhone), phoneVerifiedAt: new Date() },
    });
    await this.otp.consume(otpRequest.id);
    return toSafeUser(user);
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
      // Rattrapage d'une course bénigne (voir REFRESH_GRACE_PERIOD_MS) :
      // deux onglets/appareils qui rafraîchissent quasi simultanément avec
      // le même token de départ — le premier a déjà fait tourner le hash,
      // le second présente encore l'ancien. Accepté seulement si ce token
      // est EXACTEMENT le précédent immédiat et que la rotation qui l'a
      // supplanté est toute récente — jamais pour un token plus ancien ou
      // hors fenêtre, qui reste traité comme un rejeu réel.
      const withinGrace =
        session.previousRefreshTokenHash &&
        Date.now() - session.lastUsedAt.getTime() < REFRESH_GRACE_PERIOD_MS &&
        (await bcrypt.compare(refreshToken, session.previousRefreshTokenHash));

      if (!withinGrace) {
        await this.prisma.userSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        throw new UnauthorizedException('Session invalide ou expirée.');
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Compte indisponible.');

    // Le hash tout juste supplanté devient le nouveau "précédent" gracié —
    // que ce refresh vienne du chemin normal ou du rattrapage ci-dessus.
    const tokens = await this.rotateRefreshTokenAtomic(
      user.id,
      session.id,
      session.refreshTokenHash,
    );
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
      type: session.type,
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
    if (!user.passwordHash) {
      throw new UnauthorizedException('Ce compte ne dispose pas de mot de passe.');
    }
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

  /**
   * `public` : réutilisée telle quelle par DeviceLinkService pour créer la
   * session WEB issue d'une liaison QR (section 9) — jamais dupliquée, même
   * logique de rotation/hash de refresh token que pour une session mobile.
   */
  async createSession(
    user: User,
    context: DeviceContext,
    type: SessionType = SessionType.MOBILE,
  ): Promise<AuthTokens> {
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        type,
        refreshTokenHash: '', // remplacé juste après par signTokensForSession
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        deviceLabel: context.deviceLabel,
        expiresAt: this.computeRefreshExpiry(),
      },
    });
    return this.signTokensForSession(user.id, session.id);
  }

  private async signTokensForSession(
    userId: string,
    sessionId: string,
    previousHashToRecord: string | null = null,
  ): Promise<AuthTokens> {
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
        previousRefreshTokenHash: previousHashToRecord,
        lastUsedAt: new Date(),
        expiresAt: this.computeRefreshExpiry(),
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Même rotation que signTokensForSession, mais rendue atomique pour
   * POST /auth/refresh uniquement (audit de sécurité) : sans ceci, deux
   * appels concurrents présentant le MÊME refresh token valide passaient
   * tous les deux la comparaison bcrypt (lue avant qu'aucune écriture
   * n'atterrisse) et recevaient chacun une paire de tokens valide — un seul
   * token volé pouvait ainsi être multiplié en plusieurs paires valides au
   * lieu d'une rotation à usage unique. `expectedCurrentHash` est le hash lu
   * au tout début de refresh() (avant la comparaison bcrypt) : l'update
   * n'a lieu QUE si ce hash est toujours celui en base au moment de
   * l'écriture, verrou optimiste Prisma (`updateMany` + vérification de
   * `count`, pas d'`update` inconditionnel). `createSession()` continue
   * d'utiliser signTokensForSession() directement : aucune course possible
   * sur une ligne qui vient d'être créée.
   */
  private async rotateRefreshTokenAtomic(
    userId: string,
    sessionId: string,
    expectedCurrentHash: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, sessionId };

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
    const result = await this.prisma.userSession.updateMany({
      where: { id: sessionId, refreshTokenHash: expectedCurrentHash },
      data: {
        refreshTokenHash,
        previousRefreshTokenHash: expectedCurrentHash,
        lastUsedAt: new Date(),
        expiresAt: this.computeRefreshExpiry(),
      },
    });

    if (result.count !== 1) {
      // Un autre appel concurrent a déjà gagné la course sur ce même hash
      // de départ : ce token vient d'être consommé par l'autre appel. Le
      // gagnant a une session parfaitement valide — ne JAMAIS la révoquer
      // ici, seulement rejeter cet appel-ci.
      throw new UnauthorizedException('Session invalide ou expirée.');
    }

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
