import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validateStartupConfig } from './config/startup-validation';

async function bootstrap() {
  // Avant même de construire l'application : un secret faible/par défaut ou
  // une inscription jamais réellement vérifiée en production sont des
  // erreurs de configuration, pas des états qu'il faut laisser démarrer
  // (voir startup-validation.ts, audit de sécurité).
  validateStartupConfig(process.env);

  const app = await NestFactory.create(AppModule);

  // En-têtes de sécurité de base (section 23). CSP désactivée explicitement
  // plutôt que laissée au défaut de helmet : le défaut casserait la page
  // Swagger (/api/docs, scripts/styles inline) sans apporter grand-chose ici
  // — cette API ne sert pas de HTML applicatif. Une CSP dédiée au frontend
  // reste à affiner côté Next.js si besoin.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Nécessaire pour lire les cookies httpOnly d'authentification (audit de
  // sécurité, voir auth-cookies.util.ts) — non signés : leur contenu est un
  // JWT, déjà signé et vérifié séparément (JwtStrategy), signer le cookie
  // lui-même n'apporterait rien de plus.
  app.use(cookieParser());

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

  // Jamais exposé en production (audit de sécurité) : Swagger documente
  // toute la surface de l'API, y compris des détails utiles à un attaquant,
  // sans authentification pour le consulter.
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Glotta API')
      .setDescription(
        'API de la plateforme de messagerie multilingue Glotta — texte, vocaux et traduction en temps réel.',
      )
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);

  console.log(`Glotta API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error: unknown) => {
  console.error('Glotta API failed to start:', error);
  process.exit(1);
});
