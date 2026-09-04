import { ApiPropertyOptional } from '@nestjs/swagger';
import { WhoCanInteract } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  // Accepte une URL déjà hébergée (le flux d'upload de fichier arrive avec
  // UploadsModule, phase 9 — cet endpoint ne change pas à ce moment-là, seul
  // le frontend enverra une URL fraîchement uploadée au lieu d'une URL saisie).
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({}, { message: 'avatarUrl doit être une URL valide.' })
  avatarUrl?: string;

  @ApiPropertyOptional({ maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  statusText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showLastSeen?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showOnlineStatus?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showReadReceipts?: boolean;

  @ApiPropertyOptional({ enum: WhoCanInteract })
  @IsOptional()
  @IsEnum(WhoCanInteract)
  whoCanMessageMe?: WhoCanInteract;

  @ApiPropertyOptional({ enum: WhoCanInteract })
  @IsOptional()
  @IsEnum(WhoCanInteract)
  whoCanSeeMyStatus?: WhoCanInteract;

  // Interrupteur global (section 11). NotificationsService ne crée
  // silencieusement aucune notification tant que ceci est à false.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  // Consentement explicite (section 15) : ON/OFF volontaire, jamais activé
  // par défaut (voir Profile.voiceCloningConsent dans le schéma).
  @ApiPropertyOptional({
    description: 'Autoriser Glotta à reproduire ma voix dans les traductions vocales',
  })
  @IsOptional()
  @IsBoolean()
  voiceCloningConsent?: boolean;
}
