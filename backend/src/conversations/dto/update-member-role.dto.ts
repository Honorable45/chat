import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GroupRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: GroupRole })
  @IsEnum(GroupRole)
  role!: GroupRole;
}
