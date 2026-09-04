import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  // Aucun forwardRef() nécessaire ici (contrairement à CallsModule) : rien
  // n'a besoin d'injecter ContactsService dans EventsGateway/WebsocketModule
  // — le graphe reste un DAG simple (voir le commentaire équivalent dans
  // calls.module.ts pour le cas où ce ne serait pas vrai).
  imports: [AuthModule, UsersModule, NotificationsModule, WebsocketModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
