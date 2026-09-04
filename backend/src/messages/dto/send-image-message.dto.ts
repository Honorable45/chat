import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendImageMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  // Légende éventuelle — stockée dans le même champ `text` qu'un message
  // TEXT (voir Message.text côté schéma : "contenu texte original, si type
  // TEXT ou légende").
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
