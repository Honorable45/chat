import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, type OtpRequest } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VonageService } from '../sms/vonage.service';

const OTP_HASH_ROUNDS = 10; // plus léger que PASSWORD_SALT_ROUNDS (12) : un code à 6 chiffres expire en minutes, pas besoin du même coût.
const OTP_TTL_MS = 5 * 60 * 1000; // 5 min
const OTP_MIN_INTERVAL_MS = 45 * 1000; // anti-spam par numéro, en plus du throttle par IP au niveau du contrôleur.
const CONTINUATION_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 min — laisse le temps de saisir le PIN 2FA ou de lire l'email de récupération.

/**
 * Cycle de vie générique d'un OTP à 6 chiffres envoyé par SMS (voir
 * VonageService) — partagé entre inscription, connexion et récupération de
 * PIN 2FA (voir `OtpPurpose`). Ne stocke jamais le code en clair (`codeHash`
 * uniquement, même logique que les mots de passe/refresh tokens).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vonage: VonageService,
  ) {}

  /**
   * Crée une nouvelle demande et envoie le SMS — invalide implicitement
   * toute demande précédente non consommée pour ce (phone, purpose), qui ne
   * pourra plus jamais être vérifiée (voir findActive, ne lit que la plus
   * récente non consommée).
   */
  async request(phone: string, purpose: OtpPurpose, ipAddress?: string): Promise<void> {
    const previous = await this.prisma.otpRequest.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (previous && Date.now() - previous.createdAt.getTime() < OTP_MIN_INTERVAL_MS) {
      throw new BadRequestException('Veuillez patienter avant de redemander un code.');
    }
    // Invalide l'ancienne demande (si présente) — jamais deux codes valides
    // en même temps pour le même (phone, purpose).
    if (previous) {
      await this.prisma.otpRequest.update({
        where: { id: previous.id },
        data: { consumedAt: new Date() },
      });
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, OTP_HASH_ROUNDS);
    await this.prisma.otpRequest.create({
      data: {
        phone,
        purpose,
        codeHash,
        ipAddress,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await this.vonage.sendOtp(phone, code);
  }

  /**
   * Vérifie le code contre la demande active la plus récente — incrémente
   * `attempts` à chaque échec (jamais réinitialisé), rejette au-delà de
   * `maxAttempts` même si un code correct est ensuite présenté (protection
   * contre le brute-force, section 23).
   */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<OtpRequest> {
    const active = await this.findActive(phone, purpose);
    if (!active) throw new UnauthorizedException('Code invalide ou expiré.');
    if (active.attempts >= active.maxAttempts) {
      throw new UnauthorizedException('Trop de tentatives — redemandez un code.');
    }

    const valid = await bcrypt.compare(code, active.codeHash);
    if (!valid) {
      await this.prisma.otpRequest.update({
        where: { id: active.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    return this.prisma.otpRequest.update({
      where: { id: active.id },
      data: { verifiedAt: new Date() },
    });
  }

  /** Marque une demande vérifiée comme définitivement utilisée (fin du parcours). */
  async consume(id: string): Promise<void> {
    await this.prisma.otpRequest.update({ where: { id }, data: { consumedAt: new Date() } });
  }

  /**
   * Émet un jeton de continuation (jamais stocké en clair) pour une demande
   * déjà vérifiée — permet d'enchaîner sur une étape suivante (PIN 2FA,
   * email de récupération) sans redemander l'OTP ni le garder en mémoire
   * côté client.
   */
  async issueContinuationToken(id: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const continuationTokenHash = await bcrypt.hash(rawToken, OTP_HASH_ROUNDS);
    await this.prisma.otpRequest.update({ where: { id }, data: { continuationTokenHash } });
    return rawToken;
  }

  /**
   * Retrouve la demande vérifiée correspondant à un jeton de continuation —
   * `maxSecondFactorAttempts` distinct de `maxAttempts` (celui du code OTP
   * lui-même, déjà consommé à ce stade).
   */
  async findByContinuationToken(
    phone: string,
    purpose: OtpPurpose,
    rawToken: string,
  ): Promise<OtpRequest> {
    // Le jeton de continuation a sa PROPRE fenêtre de validité (10 min depuis
    // la vérification du code), indépendante de `expiresAt` (qui n'encadre
    // que le code OTP lui-même, déjà vérifié à ce stade) — sans ça un
    // jeton de continuation émis juste avant l'expiration du code hériterait
    // à tort d'une fenêtre bien plus courte que prévu.
    const candidates = await this.prisma.otpRequest.findMany({
      where: {
        phone,
        purpose,
        consumedAt: null,
        continuationTokenHash: { not: null },
        verifiedAt: { gt: new Date(Date.now() - CONTINUATION_TOKEN_TTL_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const candidate of candidates) {
      if (
        candidate.continuationTokenHash &&
        (await bcrypt.compare(rawToken, candidate.continuationTokenHash))
      ) {
        if (candidate.secondFactorAttempts >= candidate.maxAttempts) {
          throw new UnauthorizedException('Trop de tentatives — recommencez la connexion.');
        }
        return candidate;
      }
    }
    throw new UnauthorizedException('Session de vérification invalide ou expirée.');
  }

  async recordSecondFactorFailure(id: string): Promise<void> {
    await this.prisma.otpRequest.update({
      where: { id },
      data: { secondFactorAttempts: { increment: 1 } },
    });
  }

  private async findActive(phone: string, purpose: OtpPurpose): Promise<OtpRequest | null> {
    return this.prisma.otpRequest.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
