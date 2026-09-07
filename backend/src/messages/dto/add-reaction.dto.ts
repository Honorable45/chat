import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// Liste fixe alignée avec le sélecteur de réactions du frontend (section 9
// du cahier des charges) — jamais un emoji arbitraire, pour rester cohérent
// avec l'interface et éviter toute chaîne non prévue en base.
export const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏'] as const;

export class AddReactionDto {
  @ApiProperty({ enum: ALLOWED_REACTION_EMOJIS })
  @IsIn(ALLOWED_REACTION_EMOJIS)
  emoji!: string;
}
