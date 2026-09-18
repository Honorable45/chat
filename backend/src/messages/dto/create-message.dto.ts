import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;

  // Anti-doublon (section 30) : id généré côté client, réutilisé à l'identique
  // en cas de renvoi après un échec réseau ambigu — voir
  // MessagesService.findExistingByClientId.
  @ApiPropertyOptional({ description: 'Id idempotent généré côté client (UUID)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;
}
