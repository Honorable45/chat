import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';

@Module({
  // Ni forwardRef() ni WebsocketModule ici : CallsGateway authentifie ses
  // propres sockets (namespace "/calls", voir socket-auth.util) et ne
  // dépend jamais d'EventsGateway — voir le commentaire en tête de
  // calls.gateway.ts pour la raison (éviter un cycle de modules à trois sauts).
  imports: [
    AuthModule, // JwtAuthGuard pour CallsController
    JwtModule.register({}), // vérification des tokens WebSocket, secret passé explicitement (voir CallsGateway)
    NotificationsModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
  exports: [CallsService],
})
export class CallsModule {}
