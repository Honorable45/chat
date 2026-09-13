import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyRegisterOtpDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;

  @ApiProperty({ example: '583214' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  code!: string;

  // Optionnels comme pour l'inscription classique (voir RegisterDto) : sans
  // eux, le nom d'utilisateur généré automatiquement (voir
  // AuthService.generateUsernameFromPhone) sert de nom affiché.
  @ApiPropertyOptional({ example: 'Honoré' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'K.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @IsString()
  primaryLanguageCode?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  preferredReceiveLanguageCode?: string;

  @ApiPropertyOptional({ example: 'iPhone de Honoré' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
