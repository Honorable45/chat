import { ApiProperty } from '@nestjs/swagger';
import { ReportTarget } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTarget })
  @IsEnum(ReportTarget)
  targetType!: ReportTarget;

  @ApiProperty({ description: 'id du message, statut ou utilisateur signalé' })
  @IsString()
  targetId!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
