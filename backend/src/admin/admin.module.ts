import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { StatusesModule } from '../statuses/statuses.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// PrismaService est global (voir PrismaModule) : pas besoin de l'importer
// ici. Aucun forwardRef() nécessaire — AdminModule ne fait que consommer
// MessagesService/StatusesService (déjà exportés), rien ne dépend
// d'AdminModule en retour : le graphe reste un DAG.
@Module({
  imports: [AuthModule, MessagesModule, StatusesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
