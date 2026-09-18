import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Étape 1 du changement de numéro (section 4) : envoie l'OTP au NOUVEAU
 * numéro — jamais à l'ancien, qui n'a plus besoin d'être reprouvé. */
export class RequestPhoneChangeDto {
  @ApiProperty({ example: '+22891234567' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  newPhone!: string;
}
