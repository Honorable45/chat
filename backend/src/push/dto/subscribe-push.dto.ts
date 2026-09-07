import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

class PushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  p256dh!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  auth!: string;
}

/** Forme exacte de `PushSubscriptionJSON` (résultat de `subscription.toJSON()` côté navigateur). */
export class SubscribePushDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  endpoint!: string;

  // Toujours présent dans un vrai PushSubscriptionJSON (souvent `null`) —
  // jamais utilisé côté backend, mais doit être déclaré ici : whitelist +
  // forbidNonWhitelisted (voir main.ts) rejetteraient sinon toute requête
  // réelle de navigateur avec un 400 "property should not exist".
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}
