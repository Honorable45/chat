import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ProfilesService } from './profiles.service';

/**
 * Volontairement séparé de UsersController (protégé par JwtAuthGuard au
 * niveau de la classe) : un avatar n'est pas une donnée sensible — le
 * rendre public permet à une simple balise `<img>` de le charger sans
 * pouvoir porter d'en-tête `Authorization` (même contrainte que documentée
 * côté frontend pour AuthenticatedImage, qui devient alors inutile ici).
 */
@ApiTags('users')
@Controller('users')
export class UserAvatarController {
  constructor(private readonly profiles: ProfilesService) {}

  // Voir le commentaire équivalent sur MessagesController.streamAttachment —
  // ici chaque avatar affiché (liste de conversations, membres, cartes de
  // contact...) compte contre le même budget global de 60/min.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':id/avatar')
  async streamAvatar(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const avatar = await this.profiles.streamAvatar(id);
    res.set({
      'Content-Type': avatar.mimeType,
      'Cache-Control': 'private, max-age=300',
      // helmet() (voir main.ts) pose `Cross-Origin-Resource-Policy: same-origin`
      // par défaut sur toutes les réponses — ce qui bloque silencieusement
      // (aucune erreur serveur, juste net::ERR_BLOCKED_BY_RESPONSE côté
      // navigateur) exactement l'usage que cette route existe pour permettre :
      // une balise <img> chargée depuis le frontend, sur une origine
      // différente. Seule cette route en a besoin — le reste de l'API garde
      // la protection par défaut de helmet.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(avatar.stream);
  }
}
