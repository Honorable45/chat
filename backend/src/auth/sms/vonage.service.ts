import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Vonage } from '@vonage/server-sdk';
import { SMSStatus } from '@vonage/sms';

/**
 * Envoi de SMS (code OTP) — même convention que MailService pour l'email
 * (voir auth/mail/mail.service.ts) : SMS_PROVIDER="none" journalise le code
 * au lieu de l'envoyer réellement (dev uniquement, jamais présenté comme un
 * vrai envoi), SMS_PROVIDER="vonage" appelle l'API Vonage. Remplacer cette
 * classe par un autre fournisseur ne change que son intérieur, jamais ses
 * appelants (OtpService).
 *
 * Ne journalise JAMAIS VONAGE_API_SECRET ni le code lui-même en dehors du
 * mode "none" (où le code est le seul moyen de le récupérer en dev) —
 * voir sendOtp().
 */
@Injectable()
export class VonageService {
  private readonly logger = new Logger(VonageService.name);
  private client: Vonage | null = null;

  constructor(private readonly config: ConfigService) {}

  private getProvider(): string {
    return this.config.get<string>('SMS_PROVIDER') ?? 'none';
  }

  isDevMode(): boolean {
    return this.getProvider() !== 'vonage';
  }

  private getClient(): Vonage {
    if (this.client) return this.client;
    const apiKey = this.config.getOrThrow<string>('VONAGE_API_KEY');
    const apiSecret = this.config.getOrThrow<string>('VONAGE_API_SECRET');
    this.client = new Vonage({ apiKey, apiSecret });
    return this.client;
  }

  /**
   * Envoie le code OTP par SMS — ou le journalise en mode développement.
   * Ne renvoie jamais le code lui-même à l'appelant (OtpService le connaît
   * déjà, il vient de le générer) : cette méthode ne fait qu'acheminer.
   */
  async sendOtp(phone: string, code: string): Promise<void> {
    const brand = this.config.get<string>('VONAGE_BRAND_NAME') ?? 'Glotta';
    const text = `Votre code ${brand} est : ${code}`;

    if (this.isDevMode()) {
      // Volontairement en clair ICI UNIQUEMENT (mode développement, jamais en
      // production tant que SMS_PROVIDER reste "none") — c'est le seul moyen
      // de tester le parcours OTP sans compte Vonage réel.
      this.logger.warn(
        `SMS_PROVIDER non configuré — code OTP pour ${this.maskPhone(phone)} (dev uniquement, non envoyé par SMS) : ${code}`,
      );
      return;
    }

    try {
      const from = brand.replace(/[^a-zA-Z0-9]/g, '').slice(0, 11) || 'Glotta';
      const result = await this.getClient().sms.send({ to: phone, from, text });
      const failed = result.messages.find((m) => m.status !== SMSStatus.SUCCESS) as
        { status: string; errorText?: string } | undefined;
      if (failed) {
        this.logger.error(
          `Échec d'envoi SMS Vonage pour ${this.maskPhone(phone)} : statut ${failed.status} (${failed.errorText ?? 'raison inconnue'})`,
        );
        throw new Error("Échec de l'envoi du SMS.");
      }
    } catch (error) {
      // Jamais VONAGE_API_SECRET ni le code OTP dans ce log — seul le numéro
      // (masqué) et un message d'erreur générique.
      this.logger.error(
        `Erreur Vonage pour ${this.maskPhone(phone)} : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      throw error;
    }
  }

  /** Masque tout sauf les 2 derniers chiffres — jamais le numéro complet en clair dans les logs. */
  private maskPhone(phone: string): string {
    return phone.length <= 2 ? '**' : `${'*'.repeat(phone.length - 2)}${phone.slice(-2)}`;
  }
}
