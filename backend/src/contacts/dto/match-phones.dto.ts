import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** Synchronisation des contacts téléphoniques (section 2) — le client
 * calcule les hashs localement (voir contact_sync_service.dart côté mobile)
 * et n'envoie jamais de numéro en clair. */
export class MatchPhonesDto {
  @ApiProperty({ type: [String], description: 'Hashs SHA-256 des numéros normalisés du carnet' })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  phoneHashes!: string[];
}
