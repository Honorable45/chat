import { Module } from '@nestjs/common';
import { CloudinaryProvider } from './cloudinary.provider';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService, CloudinaryProvider],
  exports: [StorageService, CloudinaryProvider],
})
export class UploadsModule {}
