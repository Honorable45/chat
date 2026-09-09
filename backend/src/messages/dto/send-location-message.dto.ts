import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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

  // Position en direct (section "partage de position") : la position sera
  // ensuite mise à jour en place via PATCH /messages/:id/location, jamais
  // en créant un nouveau message à chaque déplacement. Sans effet sur la
  // validation de durationSeconds ci-dessous côté DTO — la cohérence
  // (durée fournie seulement si isLive) est vérifiée dans MessagesService.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLive?: boolean;

  @ApiPropertyOptional({
    description:
      'Requis si isLive — 15 min/1h/8h côté frontend, mais toute valeur dans cette plage est acceptée ici.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(8 * 60 * 60)
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
