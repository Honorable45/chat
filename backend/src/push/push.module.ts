import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FcmProvider } from './fcm.provider';
import { PushController } from './push.controller';
import { PushProvider } from './push.provider';
import { PushService } from './push.service';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushProvider, FcmProvider, PushService],
  // Exportés pour NotificationsModule/CallsModule (voir
  // NotificationsService.create, CallsService.notifyIncoming).
  exports: [PushProvider, FcmProvider],
})
export class PushModule {}
