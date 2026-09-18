import {
  StartupValidationEnv,
  validateRegistrationOtpProductionGate,
  validateSecrets,
  validateStartupConfig,
} from './startup-validation';

function buildEnv(overrides: Partial<StartupValidationEnv> = {}): StartupValidationEnv {
  return {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CALL_ACTION_JWT_SECRET: 'c'.repeat(32),
    ...overrides,
  };
}

describe('validateSecrets', () => {
  it('accepte trois secrets distincts et suffisamment longs', () => {
    expect(() => validateSecrets(buildEnv())).not.toThrow();
  });

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CALL_ACTION_JWT_SECRET'] as const)(
    '%s absent → rejet',
    (name) => {
      expect(() => validateSecrets(buildEnv({ [name]: undefined }))).toThrow();
    },
  );

  it('rejette une valeur par défaut connue de .env.example', () => {
    expect(() =>
      validateSecrets(buildEnv({ JWT_ACCESS_SECRET: 'change-me-access-secret' })),
    ).toThrow();
  });

  it('rejette un secret trop court (< 32 caractères)', () => {
    expect(() => validateSecrets(buildEnv({ JWT_ACCESS_SECRET: 'trop-court' }))).toThrow();
  });

  it('rejette si deux secrets sont identiques', () => {
    const same = 'd'.repeat(32);
    expect(() =>
      validateSecrets(buildEnv({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })),
    ).toThrow();
  });
});

describe('validateRegistrationOtpProductionGate', () => {
  it('hors production : passe quoi que valent les autres variables', () => {
    expect(() => validateRegistrationOtpProductionGate({})).not.toThrow();
    expect(() =>
      validateRegistrationOtpProductionGate({ REGISTRATION_OTP_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it('production + variable absente → rejet', () => {
    expect(() => validateRegistrationOtpProductionGate({ NODE_ENV: 'production' })).toThrow();
  });

  it('production + REGISTRATION_OTP_ENABLED="false" → rejet', () => {
    expect(() =>
      validateRegistrationOtpProductionGate({
        NODE_ENV: 'production',
        REGISTRATION_OTP_ENABLED: 'false',
      }),
    ).toThrow();
  });

  it('production + REGISTRATION_OTP_ENABLED="true" sans SMS_PROVIDER réel → rejet', () => {
    expect(() =>
      validateRegistrationOtpProductionGate({
        NODE_ENV: 'production',
        REGISTRATION_OTP_ENABLED: 'true',
      }),
    ).toThrow();
    expect(() =>
      validateRegistrationOtpProductionGate({
        NODE_ENV: 'production',
        REGISTRATION_OTP_ENABLED: 'true',
        SMS_PROVIDER: 'none',
      }),
    ).toThrow();
  });

  it('production + REGISTRATION_OTP_ENABLED="true" + SMS_PROVIDER="zavu" sans clé → rejet', () => {
    expect(() =>
      validateRegistrationOtpProductionGate({
        NODE_ENV: 'production',
        REGISTRATION_OTP_ENABLED: 'true',
        SMS_PROVIDER: 'zavu',
      }),
    ).toThrow();
  });

  it('production + REGISTRATION_OTP_ENABLED="true" + SMS_PROVIDER="zavu" + clé → accepté', () => {
    expect(() =>
      validateRegistrationOtpProductionGate({
        NODE_ENV: 'production',
        REGISTRATION_OTP_ENABLED: 'true',
        SMS_PROVIDER: 'zavu',
        ZAVUDEV_API_KEY: 'une-cle',
      }),
    ).not.toThrow();
  });
});

describe('validateStartupConfig', () => {
  it('combine les deux validations : secrets valides + hors production → accepté', () => {
    expect(() => validateStartupConfig(buildEnv())).not.toThrow();
  });

  it('combine les deux validations : secrets valides mais production sans OTP → rejet', () => {
    expect(() => validateStartupConfig(buildEnv({ NODE_ENV: 'production' }))).toThrow();
  });
});
