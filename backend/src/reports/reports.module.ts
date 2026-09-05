import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// AuthModule fournit AuthModuleOptions, requis par JwtAuthGuard (voir le
// commentaire dans auth.module.ts) — sinon aucune dépendance vers un autre
// module métier : la vérification d'existence de la cible
// (assertTargetExists) passe directement par PrismaService plutôt que par
// MessagesService/StatusesService/UsersService — le graphe reste un DAG
// simple, et AdminModule peut importer celui-ci sans jamais créer de cycle.
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
