import { createHash } from 'node:crypto';

/**
 * Hash SHA-256 non salé d'un numéro déjà normalisé (E.164, tel que stocké
 * dans `User.phone`) — permet à ContactsService.matchPhones de retrouver des
 * utilisateurs à partir de hashs calculés côté client (carnet d'adresses)
 * sans jamais faire transiter de numéro en clair. Un pepper secret serait
 * illusoire ici : il devrait être connu du client mobile pour calculer le
 * même hash, donc pas réellement secret une fois l'app décompilée — limite
 * assumée (pas de PSI complet), documentée dans le schéma Prisma.
 */
export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}
