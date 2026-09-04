import { Injectable, Logger } from '@nestjs/common';

/**
 * Aucun fournisseur d'emails transactionnels n'est branché (MAIL_PROVIDER
 * reste à "none" tant que ce n'est pas configuré). En attendant, le lien de
 * réinitialisation est journalisé pour rester utilisable en développement —
 * mais jamais présenté comme réellement envoyé (section 40 : ne pas faire
 * semblant). Remplacer ce service par un provider réel (Resend, SES, etc.)
 * changera uniquement cette classe, pas ses appelants.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  sendPasswordReset(to: string, rawToken: string): Promise<void> {
    const origin = process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;

    if (!process.env.MAIL_PROVIDER || process.env.MAIL_PROVIDER === 'none') {
      this.logger.warn(
        `MAIL_PROVIDER non configuré — lien de réinitialisation pour ${to} (dev uniquement, non envoyé par email) : ${resetUrl}`,
      );
      return Promise.resolve();
    }

    // TODO(phase fournisseurs) : brancher un vrai provider ici.
    this.logger.warn(`MAIL_PROVIDER="${process.env.MAIL_PROVIDER}" déclaré mais non implémenté.`);
    return Promise.resolve();
  }
}
