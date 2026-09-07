import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // JSON stringifié d'un tableau d'IDs (multipart, une photo de groupe
  // pouvant accompagner la création) — même convention que
  // SendMediaMessageDto.meta, lu "au mieux" côté service, jamais validé
  // au-delà d'être une chaîne ici.
  @ApiProperty({
    description:
      'Tableau JSON des IDs des membres initiaux (hors créateur, ajouté automatiquement en ADMIN).',
  })
  @IsString()
  memberIds!: string;
}
