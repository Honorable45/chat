import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendMediaMessageDto {
  @ApiProperty()
  @IsString()
  conversationId!: string;

  // Légende éventuelle — stockée dans le même champ `text` qu'un message
  // TEXT (voir Message.text côté schéma : "contenu texte original, si type
  // TEXT ou légende").
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({ description: 'id du message auquel celui-ci répond' })
  @IsOptional()
  @IsString()
  replyToId?: string;

  // JSON stringifié d'un tableau `{ fileName?, durationSeconds?, width?,
  // height? }[]`, aligné par position sur les fichiers reçus (voir
  // FilesInterceptor — même ordre que l'envoi). Jamais validé par
  // class-validator au-delà d'être une chaîne : le contenu est lu/normalisé
  // "au mieux" dans MessagesService.sendMedia, une valeur absente ou
  // invalide pour un fichier donné retombe simplement sur `null`.
  @ApiPropertyOptional({
    description:
      'Tableau JSON de métadonnées par fichier (nom, durée, dimensions), dans le même ordre que les fichiers envoyés.',
  })
  @IsOptional()
  @IsString()
  meta?: string;
}
