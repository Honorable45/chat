import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { CleanupService } from './cleanup.service';

@Module({
  imports: [UploadsModule],
  providers: [CleanupService],
})
export class MaintenanceModule {}
