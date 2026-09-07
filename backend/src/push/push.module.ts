import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushProvider } from './push.provider';
import { PushService } from './push.service';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushProvider, PushService],
  // PushProvider exporté pour NotificationsModule (voir NotificationsService.create).
  exports: [PushProvider],
})
export class PushModule {}
