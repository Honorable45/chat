import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ShareContactDto {
  @ApiProperty({ description: 'conversation dans laquelle publier la carte de contact' })
  @IsString()
  conversationId!: string;

  @ApiProperty({ description: "id de l'utilisateur dont la carte est partagée" })
  @IsString()
  userId!: string;
}
