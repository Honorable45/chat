import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
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
  imports: [
    AuthModule, // JwtAuthGuard pour CallsController
    JwtModule.register({}), // vérification des tokens WebSocket + jetons d'action d'appel, secret passé explicitement (voir CallsGateway/CallsService)
    NotificationsModule,
    PushModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
  exports: [CallsService],
})
export class CallsModule {}
