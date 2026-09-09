import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupCallsController } from './group-calls.controller';
import { GroupCallsGateway } from './group-calls.gateway';
import { GroupCallsService } from './group-calls.service';

@Module({
  // Même structure que CallsModule (voir son commentaire) : namespace
  // WebSocket dédié, aucun cycle à résoudre avec WebsocketModule/EventsGateway.
  imports: [AuthModule, JwtModule.register({}), NotificationsModule],
  controllers: [GroupCallsController],
  providers: [GroupCallsService, GroupCallsGateway],
})
export class GroupCallsModule {}
