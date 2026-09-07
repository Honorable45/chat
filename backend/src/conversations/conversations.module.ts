import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PresenceModule } from '../presence/presence.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { GroupInvitesController } from './group-invites.controller';

@Module({
  // AuthModule fournit AuthModuleOptions, requis par JwtAuthGuard.
  // ContactsModule fournit ContactsService.areContacts/statusWith (réglage
  // "whoCanMessageMe" et blocage — voir createDirect/assertCanAddToGroup).
  // WebsocketModule/NotificationsModule/UploadsModule : mêmes fournisseurs
  // que MessagesModule, réutilisés tels quels pour les messages système et
  // la photo de groupe (jamais un second mécanisme, voir la section
  // "Groupes" de ConversationsService).
  imports: [
    AuthModule,
    PresenceModule,
    ContactsModule,
    WebsocketModule,
    NotificationsModule,
    UploadsModule,
  ],
  controllers: [ConversationsController, GroupInvitesController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
