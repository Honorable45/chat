import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type ResolveReportAction = 'DISMISS' | 'REMOVE_CONTENT';

export class ResolveReportDto {
  @ApiProperty({ enum: ['DISMISS', 'REMOVE_CONTENT'] })
  @IsIn(['DISMISS', 'REMOVE_CONTENT'])
  action!: ResolveReportAction;
}
