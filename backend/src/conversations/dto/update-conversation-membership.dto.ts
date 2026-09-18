import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Préférences propres au membre courant, jamais aux autres participants. */
export class UpdateConversationMembershipDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional({ description: 'Épingler la conversation en tête de liste (section 7)' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  // Action, pas un état à stocker tel quel : remet `lastReadAt` à `null`
  // (voir ConversationsService.updateMembership) — le calcul de
  // `unreadCount` déjà existant s'en charge, aucun nouveau champ nécessaire.
  @ApiPropertyOptional({ description: '"Marquer comme non lu" (section 8)' })
  @IsOptional()
  @IsBoolean()
  markUnread?: boolean;

  // Action, pas un état à stocker tel quel : pose `hiddenAt = now()` (voir
  // ConversationsService.updateMembership).
  @ApiPropertyOptional({ description: 'Supprimer la conversation localement (section 5A)' })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}
