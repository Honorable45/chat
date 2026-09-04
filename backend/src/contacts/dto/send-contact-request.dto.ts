import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SendContactRequestDto {
  @ApiProperty({ description: "id de l'utilisateur à qui envoyer la demande" })
  @IsString()
  userId!: string;
}
