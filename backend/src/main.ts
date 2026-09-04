import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // En-têtes de sécurité de base (section 23). CSP désactivée explicitement
  // plutôt que laissée au défaut de helmet : le défaut casserait la page
  // Swagger (/api/docs, scripts/styles inline) sans apporter grand-chose ici
  // — cette API ne sert pas de HTML applicatif. Une CSP dédiée au frontend
  // reste à affiner côté Next.js si besoin.
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

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);

  console.log(`Glotta API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error: unknown) => {
  console.error('Glotta API failed to start:', error);
  process.exit(1);
});
