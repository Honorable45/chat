import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { GroupCallsModule } from '../group-calls/group-calls.module';
import { LanguagesModule } from '../languages/languages.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { TranslationsModule } from '../translations/translations.module';
import { CallTranslationService } from './call-translation.service';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';

@Module({
  // Ni forwardRef() ni WebsocketModule ici : CallsGateway authentifie ses
  // propres sockets (namespace "/calls", voir socket-auth.util) et ne
  // dépend jamais d'EventsGateway — voir le commentaire en tête de
  // calls.gateway.ts pour la raison (éviter un cycle de modules à trois sauts).
  // PushModule importé directement (plutôt que de passer par
  // NotificationsModule, qui l'importe déjà) : CallsService a besoin de
  // PushProvider.sendCallInvite, une méthode dédiée hors du chemin générique
  // de NotificationsService — voir le commentaire sur PUSH_EXCLUDED_TYPES.
  // ContactsModule : CallsService.escalateToGroup vérifie que l'invité d'un
  // appel simple devenu appel de groupe est bien un contact accepté de
  // l'appelant (aucun des deux ne fait partie de la conversation DIRECT
  // d'origine, donc aucune vérification de membership n'a de sens ici).
  // GroupCallsModule : dépendance à sens unique, jamais l'inverse (voir le
  // commentaire d'export dans group-calls.module.ts) — aucun cycle.
  imports: [
    AuthModule, // JwtAuthGuard pour CallsController
    JwtModule.register({}), // vérification des tokens WebSocket + jetons d'action d'appel, secret passé explicitement (voir CallsGateway/CallsService)
    NotificationsModule,
    PushModule,
    ContactsModule,
    GroupCallsModule,
    LanguagesModule, // CallTranslationService valide les codes de langue de réception
    TranslationsModule, // CallTranslationService : STT + traduction + synthèse vocale des fragments d'appel
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway, CallTranslationService],
  exports: [CallsService],
})
export class CallsModule {}
