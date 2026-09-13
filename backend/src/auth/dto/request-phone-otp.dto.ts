import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Réutilisé par register/request-otp, login/request-otp et
 * 2fa/recovery/request — la seule donnée nécessaire pour déclencher un SMS. */
export class RequestPhoneOtpDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;
}
