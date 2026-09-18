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
      // Le lien complet (donc le token en clair) n'est journalisé qu'EN
      // DEHORS de la production — c'est le seul moyen de tester ce
      // parcours sans fournisseur réel branché (audit de sécurité : jamais
      // de secret en clair dans les logs de production, même faute de
      // fournisseur configuré).
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `MAIL_PROVIDER non configuré — lien de réinitialisation pour ${to} (dev uniquement, non envoyé par email) : ${resetUrl}`,
        );
      } else {
        this.logger.error(
          `MAIL_PROVIDER non configuré en production — email de réinitialisation pour ${to} non envoyé.`,
        );
      }
      return Promise.resolve();
    }

    // TODO(phase fournisseurs) : brancher un vrai provider ici.
    this.logger.warn(`MAIL_PROVIDER="${process.env.MAIL_PROVIDER}" déclaré mais non implémenté.`);
    return Promise.resolve();
  }

  /** Code à 6 chiffres pour l'email de secours 2FA (voir TwoFactorService) — même repli "none" que sendPasswordReset. */
  sendVerificationCode(to: string, code: string): Promise<void> {
    if (!process.env.MAIL_PROVIDER || process.env.MAIL_PROVIDER === 'none') {
      // Même garde qu'au-dessus : jamais le code en clair en production.
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `MAIL_PROVIDER non configuré — code de vérification pour ${to} (dev uniquement, non envoyé par email) : ${code}`,
        );
      } else {
        this.logger.error(
          `MAIL_PROVIDER non configuré en production — code de vérification pour ${to} non envoyé.`,
        );
      }
      return Promise.resolve();
    }

    this.logger.warn(`MAIL_PROVIDER="${process.env.MAIL_PROVIDER}" déclaré mais non implémenté.`);
    return Promise.resolve();
  }
}
