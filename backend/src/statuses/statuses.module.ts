import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { UploadsModule } from '../uploads/uploads.module';
import { StatusesController } from './statuses.controller';
import { StatusesService } from './statuses.service';

@Module({
  // AuthModule fournit AuthModuleOptions, requis par JwtAuthGuard.
  // ContactsModule fournit ContactsService.listContactIds (visibilité
  // CONTACTS d'un statut — voir StatusesService.getContactIds).
  imports: [AuthModule, UploadsModule, ContactsModule],
  controllers: [StatusesController],
  providers: [StatusesService],
  exports: [StatusesService],
})
export class StatusesModule {}
