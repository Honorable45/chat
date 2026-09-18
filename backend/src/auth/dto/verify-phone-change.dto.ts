import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyPhoneChangeDto {
  @ApiProperty({ example: '+22891234567' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  newPhone!: string;

  @ApiProperty({ example: '583214' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  code!: string;
}
