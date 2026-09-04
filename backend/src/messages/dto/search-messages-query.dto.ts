import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class SearchMessagesQueryDto extends PaginationQueryDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  q!: string;
}
