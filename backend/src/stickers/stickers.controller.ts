import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AddFavoriteStickerDto } from './dto/add-favorite-sticker.dto';
import { StickersService } from './stickers.service';

@ApiTags('stickers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stickers')
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  @Get('favorites')
  listFavorites(@CurrentUser() user: AuthenticatedUser) {
    return this.stickers.listFavorites(user.userId);
  }

  @Post('favorites')
  @HttpCode(HttpStatus.NO_CONTENT)
  addFavorite(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddFavoriteStickerDto) {
    return this.stickers.addFavorite(user.userId, dto.emoji);
  }

  // L'emoji directement en paramètre de chemin plutôt que dans un corps de
  // requête DELETE : un simple caractère se prête bien à un segment d'URL —
  // toujours encodé côté client (encodeURIComponent), certains emojis
  // contiennent des caractères multi-octets.
  @Delete('favorites/:emoji')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFavorite(@CurrentUser() user: AuthenticatedUser, @Param('emoji') emoji: string) {
    return this.stickers.removeFavorite(user.userId, emoji);
  }
}
