import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class SendLocationMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
