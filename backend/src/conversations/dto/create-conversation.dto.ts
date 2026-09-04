import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ description: "id de l'autre participant" })
  @IsString()
  userId!: string;
}
