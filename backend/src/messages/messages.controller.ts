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
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_MEDIA_ALBUM_ITEMS,
  MAX_VIDEO_SIZE_BYTES,
} from '../uploads/media-upload.constants';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMediaQueryDto } from './dto/list-media-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SearchMessagesQueryDto } from './dto/search-messages-query.dto';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { SendMediaMessageDto } from './dto/send-media-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessagesService } from './messages.service';

// Pas de préfixe de contrôleur unique : la création suit REST section 27
// (`POST /messages`) tandis que la liste est imbriquée sous sa conversation
// (`GET /conversations/:id/messages`).
@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('messages')
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMessageDto) {
    return this.messages.send(user.userId, dto);
  }

  @Post('messages/image')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      // Marge au-dessus de la limite métier (MAX_IMAGE_SIZE_BYTES) : Multer
      // rejette ici avec une erreur générique côté transport, MessagesService
      // avec un message explicite — le service reste la source de vérité.
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES + 1024 },
    }),
  )
  sendImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SendImageMessageDto,
  ) {
    return this.messages.sendImage(user.userId, dto, file);
  }

  @Post('messages/media')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('media', MAX_MEDIA_ALBUM_ITEMS, {
      storage: memoryStorage(),
      // Marge au-dessus de la plus grande limite métier (vidéo) : Multer
      // rejette ici avec une erreur générique côté transport, MessagesService
      // avec un message explicite par fichier — le service reste la source
      // de vérité (même principe que POST /messages/image).
      limits: { fileSize: MAX_VIDEO_SIZE_BYTES + 1024 },
    }),
  )
  sendMedia(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: SendMediaMessageDto,
  ) {
    return this.messages.sendMedia(user.userId, dto, files);
  }

  // Limite globale par défaut (60/min, voir app.module.ts) beaucoup trop
  // basse pour ce endpoint : une seule conversation avec un album de
  // plusieurs photos déclenche déjà plusieurs requêtes en parallèle rien
  // qu'à l'ouverture, en plus de toutes les autres routes de la page —
  // provoquait des 429 sur des images pourtant légitimes (bug constaté en
  // conditions réelles). Une simple lecture de fichier déjà autorisée par
  // appartenance (voir MessagesService.streamAttachment) peut se permettre
  // une limite bien plus généreuse.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('messages/attachments/:id')
  async streamAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.messages.streamAttachment(user.userId, id);
    res.set({ 'Content-Type': attachment.mimeType });
    return new StreamableFile(attachment.stream);
  }

  // Même raison que le Throttle sur streamAttachment ci-dessus — cette
  // route est appelée à chaque ouverture du panneau "Infos" en plus du
  // chargement normal de l'historique.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('conversations/:conversationId/media')
  listMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMediaQueryDto,
  ) {
    return this.messages.listMedia(user.userId, conversationId, query.cursor, query.limit);
  }

  @Get('conversations/:conversationId/messages')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messages.list(user.userId, conversationId, query);
  }

  /**
   * Recherche texte dans la conversation — voir MessagesService.search.
   * Débounce déjà appliqué côté client (voir SearchPanel), mais une frappe
   * rapide peut quand même dépasser la limite globale de 60/min — même
   * raison que le Throttle sur streamAttachment plus haut.
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('conversations/:conversationId/messages/search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query() query: SearchMessagesQueryDto,
  ) {
    return this.messages.search(user.userId, conversationId, query.q, query.cursor, query.limit);
  }

  /** Contexte immédiat autour d'un résultat de recherche — voir MessagesService.listAroundMessage. */
  @Get('conversations/:conversationId/messages/around/:messageId')
  listAroundMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messages.listAroundMessage(user.userId, conversationId, messageId);
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messages.markConversationRead(user.userId, conversationId);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messages.edit(user.userId, id, dto);
  }

  @Delete('messages/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.messages.remove(user.userId, id);
  }
}
