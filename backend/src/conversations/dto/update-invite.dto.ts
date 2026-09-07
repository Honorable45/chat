import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateInviteDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
