import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWebLinkRequestDto {
  // Purement déclaratif (section 6 : jamais utilisé pour une décision de
  // sécurité) — juste ce qui s'affichera sur l'écran de confirmation mobile
  // (section 8 : "Navigateur : Firefox, Système : Ubuntu").
  @ApiPropertyOptional({ example: 'Firefox' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  browserName?: string;

  @ApiPropertyOptional({ example: 'Ubuntu' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  operatingSystem?: string;
}

export class ScanWebLinkRequestDto {
  @ApiProperty({ description: 'Valeur brute extraite du QR (glotta://link-device?request=...)' })
  @IsString()
  token!: string;
}

export class ConfirmWebLinkRequestDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ enum: ['confirm', 'cancel'] })
  @IsIn(['confirm', 'cancel'])
  decision!: 'confirm' | 'cancel';

  @ApiPropertyOptional({ example: 'Firefox sur Ubuntu (lié par QR)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
