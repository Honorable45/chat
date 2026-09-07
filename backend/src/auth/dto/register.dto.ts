import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  // Optionnel : l'inscription ne demande plus que nom d'utilisateur/email/
  // mot de passe (voir AuthService.register) — un compte sans prénom/nom
  // fournis affiche son nom d'utilisateur à la place, modifiable ensuite
  // depuis Paramètres → Profil.
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

  @ApiProperty({ example: 'honore' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_.]+$/, {
    message:
      "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, points et underscores.",
  })
  username!: string;

  @ApiPropertyOptional({ example: 'honore@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  // Regex volontairement simple (pas de dépendance libphonenumber-js pour le
  // MVP) : accepte un numéro international optionnellement préfixé de "+".
  @ApiPropertyOptional({ example: '+22890000000' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone?: string;

  // bcrypt ignore silencieusement tout ce qui dépasse 72 octets : on borne la
  // longueur ici plutôt que de laisser un mot de passe être tronqué sans le
  // dire à l'utilisateur.
  @ApiProperty({ example: 'un-mot-de-passe-solide' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  // Optionnel : défaut "fr" (voir AuthService.register) — l'utilisateur
  // peut la changer ensuite depuis Paramètres → Profil.
  @ApiPropertyOptional({ example: 'fr', description: 'Code de la langue principale (défaut : fr)' })
  @IsOptional()
  @IsString()
  primaryLanguageCode?: string;

  @ApiPropertyOptional({
    example: 'en',
    description: 'Langue dans laquelle recevoir les traductions (défaut : langue principale)',
  })
  @IsOptional()
  @IsString()
  preferredReceiveLanguageCode?: string;

  @ApiPropertyOptional({ example: 'Chrome sur macOS' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
