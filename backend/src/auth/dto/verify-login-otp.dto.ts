import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyLoginOtpDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;

  @ApiProperty({ example: '583214' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  code!: string;

  @ApiPropertyOptional({ example: 'iPhone de Honoré' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
