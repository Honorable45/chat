import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RequestVoiceTranslationDto {
  @ApiProperty({
    example: 'en',
    description: 'Code de la langue vers laquelle traduire ce vocal (choisie par le destinataire).',
  })
  @IsString()
  languageCode!: string;
}
