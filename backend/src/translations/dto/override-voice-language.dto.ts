import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class OverrideVoiceLanguageDto {
  @ApiProperty({ example: 'fr', description: 'Code de la langue réellement parlée dans le vocal' })
  @IsString()
  languageCode!: string;
}
