import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Voir AuthController.adoptTokens — le refresh token n'a pas de guard qui
 * le vérifie ici (contrairement à l'access token, porté par l'en-tête
 * Authorization et déjà validé par JwtAuthGuard) : il est simplement reposé
 * tel quel en cookie, jamais interprété par ce endpoint. */
export class AdoptTokensDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}
