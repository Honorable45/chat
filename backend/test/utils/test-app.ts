import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

/** Même pipeline que main.ts (préfixe, filtre, validation, en-têtes de
 * sécurité, CORS) — pour que les tests e2e exercent exactement ce que subit
 * une vraie requête. `helmet()` en manquait jusqu'à ce qu'un bug réel
 * (Cross-Origin-Resource-Policy bloquant le chargement de l'avatar en
 * <img> cross-origine, jamais détecté par aucun test) révèle que cette
 * fonction ne reproduisait pas fidèlement main.ts malgré son commentaire —
 * voir avatar.e2e-spec.ts pour la régression correspondante.
 *
 * Le rate limiting est désactivé pendant les tests via `DISABLE_RATE_LIMITING`
 * (voir .env.test et le `skipIf` dans app.module.ts) — c'est déjà vérifié en
 * conditions réelles (phase 15), et le laisser actif ferait échouer une suite
 * e2e généreuse en inscriptions/connexions pour des raisons sans rapport avec
 * ce qui est testé. `overrideProvider(APP_GUARD)` a été essayé ici et NE
 * fonctionne PAS : Nest ne réévalue pas les enhancers globaux déjà collectés
 * au bootstrap dans un module de test (limitation constatée en pratique). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
