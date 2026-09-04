/**
 * Résout l'URL d'avatar à renvoyer au client : un avatar téléversé
 * (`avatarStorageKey`, servi via GET /users/:id/avatar) prime toujours sur
 * une URL externe saisie à la main (`avatarUrl`) — jamais les deux en même
 * temps, voir UsersService.setAvatar / removeAvatar qui maintiennent cette
 * exclusivité à l'écriture.
 */
export function resolveAvatarUrl(
  profile: { avatarUrl: string | null; avatarStorageKey: string | null } | null | undefined,
  userId: string,
): string | null {
  if (!profile) return null;
  if (profile.avatarStorageKey) return `/api/users/${userId}/avatar`;
  return profile.avatarUrl;
}
