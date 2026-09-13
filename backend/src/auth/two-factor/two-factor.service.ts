import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { EmailVerificationPurpose, OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';

const PIN_HASH_ROUNDS = 12; // même coût que les mots de passe (voir AuthService.PASSWORD_SALT_ROUNDS) : un PIN protège l'accès au compte, pas moins sensible.
const EMAIL_CODE_HASH_ROUNDS = 10;
const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000; // 15 min — plus long qu'un OTP SMS (5 min) : le temps de basculer vers sa boîte mail.

export interface TwoFactorStatus {
  enabled: boolean;
  hasRecoveryEmail: boolean;
  recoveryEmailVerified: boolean;
}

/**
 * Vérification en deux étapes par PIN (section 3-4) — jamais de PIN en clair
 * (twoFactorPinHash uniquement, même logique que les mots de passe). La
 * création de session après une connexion 2FA réussie vit dans
 * AuthService.verifyTwoFactorPin (a besoin de createSession), pas ici : ce
 * service ne gère que le cycle de vie du PIN et de l'email de secours.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      enabled: user.twoFactorEnabled,
      hasRecoveryEmail: !!user.recoveryEmail,
      recoveryEmailVerified: !!user.recoveryEmailVerifiedAt,
    };
  }

  async enable(userId: string, pin: string): Promise<void> {
    const pinHash = await bcrypt.hash(pin, PIN_HASH_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorPinHash: pinHash },
    });
  }

  async disable(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorEnabled || !user.twoFactorPinHash) {
      throw new BadRequestException("La vérification en deux étapes n'est pas activée.");
    }
    const valid = await bcrypt.compare(pin, user.twoFactorPinHash);
    if (!valid) throw new UnauthorizedException('PIN incorrect.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorPinHash: null },
    });
  }

  async changePin(userId: string, currentPin: string, newPin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorEnabled || !user.twoFactorPinHash) {
      throw new BadRequestException("La vérification en deux étapes n'est pas activée.");
    }
    const valid = await bcrypt.compare(currentPin, user.twoFactorPinHash);
    if (!valid) throw new UnauthorizedException('PIN actuel incorrect.');

    const pinHash = await bcrypt.hash(newPin, PIN_HASH_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorPinHash: pinHash } });
  }

  /** Ajout/remplacement de l'email de secours (section 4) — pas encore actif tant que verifyRecoveryEmail n'a pas confirmé la possession de la boîte. */
  async requestRecoveryEmail(userId: string, email: string): Promise<void> {
    const code = this.generateEmailCode();
    const codeHash = await bcrypt.hash(code, EMAIL_CODE_HASH_ROUNDS);
    await this.prisma.emailVerification.create({
      data: {
        userId,
        email,
        purpose: EmailVerificationPurpose.RECOVERY_EMAIL_LINK,
        codeHash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    await this.mail.sendVerificationCode(email, code);
  }

  async verifyRecoveryEmail(userId: string, code: string): Promise<void> {
    const pending = await this.prisma.emailVerification.findFirst({
      where: {
        userId,
        purpose: EmailVerificationPurpose.RECOVERY_EMAIL_LINK,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending || pending.attempts >= pending.maxAttempts) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    const valid = await bcrypt.compare(code, pending.codeHash);
    if (!valid) {
      await this.prisma.emailVerification.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: pending.id },
        data: { verifiedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { recoveryEmail: pending.email, recoveryEmailVerifiedAt: new Date() },
      }),
    ]);
  }

  /** Étape 1 de "PIN oublié" (section 4) : reconfirmer le numéro par SMS. */
  async recoveryRequest(phone: string, ipAddress?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    // Même réponse que le compte existe ou non / ait un email de secours ou
    // non (protection contre l'énumération, section 23).
    if (!user || !user.twoFactorEnabled || !user.recoveryEmailVerifiedAt) return;
    await this.otp.request(phone, OtpPurpose.RECOVERY_PHONE, ipAddress);
  }

  /**
   * Étape 2 : le code SMS est bon → envoie un second code à l'email de
   * secours DÉJÀ vérifié et renvoie un jeton de continuation pour la
   * dernière étape (voir recoveryResetPin). Ne confirme JAMAIS la 2FA par le
   * seul numéro : l'email reste une preuve de possession indépendante.
   */
  async recoveryVerifyPhone(phone: string, code: string): Promise<{ continuationToken: string }> {
    const otpRequest = await this.otp.verify(phone, OtpPurpose.RECOVERY_PHONE, code);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.twoFactorEnabled || !user.recoveryEmailVerifiedAt || !user.recoveryEmail) {
      throw new UnauthorizedException('Récupération indisponible pour ce compte.');
    }

    const emailCode = this.generateEmailCode();
    const codeHash = await bcrypt.hash(emailCode, EMAIL_CODE_HASH_ROUNDS);
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        email: user.recoveryEmail,
        purpose: EmailVerificationPurpose.RECOVERY_EMAIL_CONFIRM,
        codeHash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    await this.mail.sendVerificationCode(user.recoveryEmail, emailCode);

    const continuationToken = await this.otp.issueContinuationToken(otpRequest.id);
    return { continuationToken };
  }

  /** Étape 3 (finale) : les deux facteurs de récupération sont vérifiés → nouveau PIN. */
  async recoveryResetPin(
    phone: string,
    continuationToken: string,
    emailCode: string,
    newPin: string,
  ): Promise<void> {
    const otpRequest = await this.otp.findByContinuationToken(
      phone,
      OtpPurpose.RECOVERY_PHONE,
      continuationToken,
    );
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new UnauthorizedException('Récupération indisponible pour ce compte.');

    const pending = await this.prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        purpose: EmailVerificationPurpose.RECOVERY_EMAIL_CONFIRM,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending || pending.attempts >= pending.maxAttempts) {
      await this.otp.recordSecondFactorFailure(otpRequest.id);
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    const valid = await bcrypt.compare(emailCode, pending.codeHash);
    if (!valid) {
      await Promise.all([
        this.prisma.emailVerification.update({
          where: { id: pending.id },
          data: { attempts: { increment: 1 } },
        }),
        this.otp.recordSecondFactorFailure(otpRequest.id),
      ]);
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    const pinHash = await bcrypt.hash(newPin, PIN_HASH_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { twoFactorPinHash: pinHash } }),
      this.prisma.emailVerification.update({
        where: { id: pending.id },
        data: { verifiedAt: new Date() },
      }),
    ]);
    await this.otp.consume(otpRequest.id);
  }

  private generateEmailCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }
}
