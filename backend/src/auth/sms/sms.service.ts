import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ZAVU_SEND_URL = 'https://api.zavu.dev/v1/messages';

/**
 * Envoi de SMS (code OTP) — même convention que MailService pour l'email
 * (voir auth/mail/mail.service.ts) : SMS_PROVIDER="none" journalise le code
 * au lieu de l'envoyer réellement (dev uniquement, jamais présenté comme un
 * vrai envoi), SMS_PROVIDER="zavu" appelle l'API SMS Zavu. Remplacer cette
 * classe par un autre fournisseur ne change que son intérieur, jamais ses
 * appelants (OtpService).
 *
 * Ne journalise JAMAIS ZAVUDEV_API_KEY ni le code lui-même en dehors du
 * mode "none" (où le code est le seul moyen de le récupérer en dev) —
 * voir sendOtp().
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  private getProvider(): string {
    return this.config.get<string>('SMS_PROVIDER') ?? 'none';
  }

  isDevMode(): boolean {
    return this.getProvider() !== 'zavu';
  }

  /**
   * Envoie le code OTP par SMS — ou le journalise en mode développement.
   * Ne renvoie jamais le code lui-même à l'appelant (OtpService le connaît
   * déjà, il vient de le générer) : cette méthode ne fait qu'acheminer.
   */
  async sendOtp(phone: string, code: string): Promise<void> {
    const text = `Votre code Glotta est : ${code}`;

    if (this.isDevMode()) {
      // Volontairement en clair ICI UNIQUEMENT (mode développement, jamais en
      // production tant que SMS_PROVIDER reste "none") — c'est le seul moyen
      // de tester le parcours OTP sans clé Zavu réelle.
      this.logger.warn(
        `SMS_PROVIDER non configuré — code OTP pour ${this.maskPhone(phone)} (dev uniquement, non envoyé par SMS) : ${code}`,
      );
      return;
    }

    const apiKey = this.config.getOrThrow<string>('ZAVUDEV_API_KEY');

    try {
      const response = await fetch(ZAVU_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phone,
          text,
          channel: 'sms',
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(
          `Échec d'envoi SMS Zavu pour ${this.maskPhone(phone)} : HTTP ${response.status} (${body.slice(0, 200)})`,
        );
        throw new Error("Échec de l'envoi du SMS.");
      }
    } catch (error) {
      // Jamais ZAVUDEV_API_KEY ni le code OTP dans ce log — seul le numéro
      // (masqué) et un message d'erreur générique.
      this.logger.error(
        `Erreur Zavu pour ${this.maskPhone(phone)} : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      throw error;
    }
  }

  /** Masque tout sauf les 2 derniers chiffres — jamais le numéro complet en clair dans les logs. */
  private maskPhone(phone: string): string {
    return phone.length <= 2 ? '**' : `${'*'.repeat(phone.length - 2)}${phone.slice(-2)}`;
  }
}
