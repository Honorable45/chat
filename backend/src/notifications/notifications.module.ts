import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  // PresenceModule ajouté pour PresenceService.isViewingConversation (voir
  // NotificationsService.create) — aucun forwardRef nécessaire : Presence ne
  // dépend jamais de Notifications, le graphe reste un DAG.
  imports: [AuthModule, WebsocketModule, PresenceModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
