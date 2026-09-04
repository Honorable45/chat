import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class BlockContactDto {
  @ApiProperty({ description: "id de l'utilisateur à bloquer/débloquer" })
  @IsString()
  userId!: string;
}
