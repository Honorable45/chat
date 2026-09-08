import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class AddFavoriteStickerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8)
  emoji!: string;
}
