/**
 * Contrôles exécutés une seule fois au démarrage (voir main.ts, avant
 * NestFactory.create) — jamais à l'exécution normale d'une requête. Un
 * échec ici doit empêcher le processus de démarrer (process.exit(1) côté
 * appelant) : mieux vaut un déploiement qui ne démarre pas du tout qu'un
 * déploiement qui démarre avec des secrets faibles ou une inscription
 * jamais réellement vérifiée par téléphone.
 */

const KNOWN_DEFAULT_SECRETS = new Set([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'change-me-call-action-secret',
]);

const MIN_SECRET_LENGTH = 32;

export interface StartupValidationEnv {
  NODE_ENV?: string;
  JWT_ACCESS_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  CALL_ACTION_JWT_SECRET?: string;
  REGISTRATION_OTP_ENABLED?: string;
  SMS_PROVIDER?: string;
  ZAVUDEV_API_KEY?: string;
  ALLOW_UNVERIFIED_PHONE_REGISTRATION?: string;
}

/**
 * Lève une erreur (message clair, jamais le secret lui-même) si un des
 * trois secrets JWT est absent, une valeur par défaut connue de
 * .env.example, trop court, ou identique à un autre — dans tous les
 * environnements (dev/test/prod) : c'est justement ce qui force à générer
 * de vraies valeurs plutôt que de copier .env.example tel quel, y compris
 * en développement.
 */
export function validateSecrets(env: StartupValidationEnv): void {
  const secrets: Array<[string, string | undefined]> = [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ['CALL_ACTION_JWT_SECRET', env.CALL_ACTION_JWT_SECRET],
  ];

  for (const [name, value] of secrets) {
    if (!value) {
      throw new Error(`${name} est absent. Générez une valeur aléatoire d'au moins 32 caractères.`);
    }
    if (KNOWN_DEFAULT_SECRETS.has(value)) {
      throw new Error(
        `${name} utilise encore la valeur d'exemple de .env.example — générez une valeur aléatoire qui vous est propre.`,
      );
    }
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`${name} est trop court (minimum ${MIN_SECRET_LENGTH} caractères).`);
    }
  }

  const [[, access], [, refresh], [, callAction]] = secrets;
  if (access === refresh || access === callAction || refresh === callAction) {
    throw new Error(
      'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET et CALL_ACTION_JWT_SECRET doivent être trois valeurs distinctes.',
    );
  }
}

/**
 * En production : refuse par défaut de démarrer si l'OTP d'inscription par
 * téléphone n'est pas activé avec un vrai fournisseur SMS configuré — sans
 * quoi un numéro pourrait être marqué vérifié sans jamais avoir prouvé la
 * possession du téléphone (voir AuthService.isRegistrationOtpEnabled, dont
 * le bypass reste volontairement disponible en dehors de la production).
 *
 * `ALLOW_UNVERIFIED_PHONE_REGISTRATION=true` lève cette garde
 * explicitement (décision produit, 2026-09) : le démarrage est alors
 * autorisé mais journalise un avertissement à chaque fois, pour que ce
 * choix reste visible tant qu'il n'est pas revu.
 */
export function validateRegistrationOtpProductionGate(env: StartupValidationEnv): void {
  if (env.NODE_ENV !== 'production') return;

  if (env.REGISTRATION_OTP_ENABLED !== 'true') {
    // Dérogation explicite et volontaire (jamais le comportement par
    // défaut) : décision produit de faire tourner la production sans
    // vérification OTP réelle pour le moment. Reste visible dans les logs à
    // chaque démarrage tant que ce choix n'est pas revu — un numéro de
    // téléphone peut être marqué "vérifié" sans jamais avoir reçu de SMS
    // tant que cette variable est présente.
    if (env.ALLOW_UNVERIFIED_PHONE_REGISTRATION === 'true') {
      console.warn(
        'ATTENTION : ALLOW_UNVERIFIED_PHONE_REGISTRATION=true — REGISTRATION_OTP_ENABLED est désactivé en ' +
          "production, l'inscription par téléphone accepte des numéros jamais vérifiés par SMS. Retirez cette " +
          'variable dès que REGISTRATION_OTP_ENABLED=true peut être activé avec un vrai SMS_PROVIDER.',
      );
      return;
    }
    throw new Error(
      'REGISTRATION_OTP_ENABLED doit valoir "true" en production : la vérification OTP du numéro de téléphone à ' +
        "l'inscription ne peut pas rester désactivée en production. Pour déroger temporairement à cette règle en " +
        'connaissance de cause, définissez ALLOW_UNVERIFIED_PHONE_REGISTRATION=true.',
    );
  }

  if (!env.SMS_PROVIDER || env.SMS_PROVIDER === 'none') {
    throw new Error(
      'SMS_PROVIDER doit être configuré sur un vrai fournisseur en production (REGISTRATION_OTP_ENABLED=true exige de pouvoir réellement envoyer le code).',
    );
  }

  if (env.SMS_PROVIDER === 'zavu' && !env.ZAVUDEV_API_KEY) {
    throw new Error('ZAVUDEV_API_KEY est requis en production quand SMS_PROVIDER="zavu".');
  }
}

export function validateStartupConfig(env: StartupValidationEnv): void {
  validateSecrets(env);
  validateRegistrationOtpProductionGate(env);
}
