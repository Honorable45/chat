import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  // Optionnel (audit de sécurité, migration cookies) : le web peut
  // désormais fournir son refresh token uniquement via le cookie httpOnly
  // scopé à cette route (voir AuthController.refresh) — le mobile continue
  // de le fournir ici, dans le corps, inchangé. Un des deux doit être
  // présent, sinon AuthController.refresh rejette explicitement.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
