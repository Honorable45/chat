import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProfilesModule } from './profiles/profiles.module';
import { LanguagesModule } from './languages/languages.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { CallsModule } from './calls/calls.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { VoiceModule } from './voice/voice.module';
import { TranslationsModule } from './translations/translations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { StatusesModule } from './statuses/statuses.module';
import { UploadsModule } from './uploads/uploads.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // Limite globale par défaut (section 23) — les endpoints sensibles
    // (auth) ont leur propre limite plus stricte via @Throttle(). Ne
    // s'applique qu'aux routes HTTP : les connexions WebSocket ne sont pas
    // couvertes par ce guard (limite connue, notée dans PHASES.md).
    // `skipIf` n'est activé que par .env.test (jamais .env/.env.example) :
    // désactive complètement le rate limiting — y compris les limites par
    // route via @Throttle() — pendant les tests e2e, sans quoi une suite un
    // peu généreuse en inscriptions/connexions déclencherait de faux échecs
    // sans rapport avec ce qui est testé. overrideProvider(APP_GUARD) ne
    // suffit pas ici : Nest ne réévalue pas les enhancers globaux déjà
    // collectés au bootstrap dans un module de test (vérifié en pratique).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      skipIf: () => process.env.DISABLE_RATE_LIMITING === 'true',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    LanguagesModule,
    ConversationsModule,
    MessagesModule,
    CallsModule,
    ContactsModule,
    VoiceModule,
    TranslationsModule,
    NotificationsModule,
    PresenceModule,
    StatusesModule,
    UploadsModule,
    WebsocketModule,
    MaintenanceModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
