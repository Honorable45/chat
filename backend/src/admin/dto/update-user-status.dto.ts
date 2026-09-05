import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'true pour réactiver, false pour désactiver le compte' })
  @IsBoolean()
  isActive!: boolean;
}
