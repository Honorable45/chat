import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsOptional } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'honore', description: 'Username, email ou téléphone' })
  @IsString()
  @MinLength(1)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({ example: 'Chrome sur macOS' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
