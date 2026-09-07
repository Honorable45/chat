import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { PushModule } from '../push/push.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  // PresenceModule ajouté pour PresenceService.isViewingConversation (voir
  // NotificationsService.create) — aucun forwardRef nécessaire : Presence ne
  // dépend jamais de Notifications, le graphe reste un DAG. PushModule pour
  // PushProvider (notifications hors de l'app, même méthode create()).
  imports: [AuthModule, WebsocketModule, PresenceModule, PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
