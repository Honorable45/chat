import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GroupPermission } from '@prisma/client';

export class UpdateGroupDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: GroupPermission })
  @IsOptional()
  @IsEnum(GroupPermission)
  editInfoPermission?: GroupPermission;

  @ApiPropertyOptional({ enum: GroupPermission })
  @IsOptional()
  @IsEnum(GroupPermission)
  sendMessagesPermission?: GroupPermission;

  @ApiPropertyOptional({ enum: GroupPermission })
  @IsOptional()
  @IsEnum(GroupPermission)
  addMembersPermission?: GroupPermission;

  @ApiPropertyOptional({ enum: GroupPermission })
  @IsOptional()
  @IsEnum(GroupPermission)
  sendMediaPermission?: GroupPermission;

  @ApiPropertyOptional({ enum: GroupPermission })
  @IsOptional()
  @IsEnum(GroupPermission)
  mentionEveryonePermission?: GroupPermission;
}
