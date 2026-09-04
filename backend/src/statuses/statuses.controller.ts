import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { MAX_VIDEO_SIZE_BYTES } from '../uploads/media-upload.constants';
import { CreateStatusDto } from './dto/create-status.dto';
import { StatusesService } from './statuses.service';

@ApiTags('statuses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('statuses')
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('media', {
      storage: memoryStorage(),
      // Plus large des trois limites (vidéo) + marge ; chaque type applique
      // sa propre limite précise dans StatusesService.
      limits: { fileSize: MAX_VIDEO_SIZE_BYTES + 1024 },
    }),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateStatusDto,
  ) {
    return this.statuses.create(user.userId, dto, file);
  }

  @Get()
  listVisible(@CurrentUser() user: AuthenticatedUser) {
    return this.statuses.listVisible(user.userId);
  }

  // Voir le commentaire équivalent sur MessagesController.streamAttachment.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':id/media')
  async streamMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const media = await this.statuses.streamMedia(user.userId, id);
    res.set({ 'Content-Type': media.mimeType });
    return new StreamableFile(media.stream);
  }

  @Get(':id/views')
  getViews(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.statuses.getViews(user.userId, id);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  markViewed(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.statuses.markViewed(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.statuses.remove(user.userId, id);
  }
}
