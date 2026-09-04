import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { PresenceModule } from '../presence/presence.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  // AuthModule fournit AuthModuleOptions, requis par JwtAuthGuard.
  // ContactsModule fournit ContactsService.areContacts (réglage
  // "whoCanMessageMe" — voir ConversationsService.createDirect).
  imports: [AuthModule, PresenceModule, ContactsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
