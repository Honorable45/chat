import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UnsubscribePushDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  endpoint!: string;
}
