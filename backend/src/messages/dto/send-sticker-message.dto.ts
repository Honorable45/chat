import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendStickerMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  // Le caractère emoji lui-même — stocké tel quel dans Message.text (voir
  // MessageType.STICKER), jamais un identifiant vers un pack/une image :
  // aucune bibliothèque de vrais stickers n'est disponible pour ce projet,
  // un gros emoji en tient lieu (voir StickerPicker côté frontend).
  // MaxLength(8) : large marge pour un emoji multi-code-point (ex. drapeaux,
  // séquences ZWJ), jamais une vraie chaîne de texte libre.
  @ApiProperty()
  @IsString()
  @MaxLength(8)
  emoji!: string;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
