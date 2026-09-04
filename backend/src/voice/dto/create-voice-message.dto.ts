import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_VOICE_DURATION_SECONDS } from '../../uploads/audio-upload.constants';

// multipart/form-data : les champs hors fichier arrivent en chaînes, d'où le
// @Type(() => Number) explicite pour durationSeconds.
export class CreateVoiceMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_VOICE_DURATION_SECONDS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_VOICE_DURATION_SECONDS)
  durationSeconds!: number;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;

  // multipart ne supporte pas les tableaux imbriqués nativement : envoyé en
  // JSON stringifié, parsé et validé dans VoiceService plutôt qu'ici.
  @ApiPropertyOptional({
    description: 'Amplitudes pour l\'affichage waveform, en JSON stringifié (ex. "[0.1,0.4,...]")',
  })
  @IsOptional()
  @IsString()
  waveform?: string;
}
