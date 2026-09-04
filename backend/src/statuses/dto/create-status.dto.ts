import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StatusType, StatusVisibility } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStatusDto {
  @ApiProperty({ enum: StatusType })
  @IsEnum(StatusType)
  type!: StatusType;

  // Texte du statut (type TEXT) ou légende (IMAGE/VIDEO/VOICE).
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({ enum: StatusVisibility, default: 'CONTACTS' })
  @IsOptional()
  @IsEnum(StatusVisibility)
  visibility?: StatusVisibility;
}
