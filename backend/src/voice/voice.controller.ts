import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { OverrideVoiceLanguageDto } from '../translations/dto/override-voice-language.dto';
import { MAX_AUDIO_SIZE_BYTES } from '../uploads/audio-upload.constants';
import { CreateVoiceMessageDto } from './dto/create-voice-message.dto';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('messages')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      // Marge au-dessus de la limite métier (MAX_AUDIO_SIZE_BYTES) : Multer
      // rejette ici avec une erreur générique côté transport, VoiceService
      // avec un message explicite — le service reste la source de vérité.
      limits: { fileSize: MAX_AUDIO_SIZE_BYTES + 1024 },
    }),
  )
  send(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateVoiceMessageDto,
  ) {
    return this.voice.send(user.userId, dto, file);
  }

  // Même raison que le Throttle sur streamAudio ci-dessous : hydratation à
  // la demande, potentiellement plusieurs fois dans le même historique.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':messageId')
  getDetails(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.voice.getDetails(user.userId, messageId);
  }

  // Voir le commentaire équivalent sur MessagesController.streamAttachment —
  // même problème (limite globale de 60/min trop basse pour un simple
  // fichier déjà autorisé par appartenance), même remède.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':messageId/audio')
  async streamAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const audio = await this.voice.streamAudio(user.userId, messageId);
    res.set({ 'Content-Type': audio.mimeType });
    return new StreamableFile(audio.stream);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':messageId/translations/:languageCode/audio')
  async streamTranslatedAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Param('languageCode') languageCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const audio = await this.voice.streamTranslatedAudio(user.userId, messageId, languageCode);
    res.set({ 'Content-Type': audio.mimeType });
    return new StreamableFile(audio.stream);
  }

  @Delete(':messageId')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.voice.remove(user.userId, messageId);
  }

  @Post(':messageId/transcribe')
  @HttpCode(HttpStatus.ACCEPTED)
  retranscribe(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.voice.retranscribe(user.userId, messageId);
  }

  @Patch(':messageId/language')
  overrideLanguage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: OverrideVoiceLanguageDto,
  ) {
    return this.voice.overrideLanguage(user.userId, messageId, dto.languageCode);
  }
}
