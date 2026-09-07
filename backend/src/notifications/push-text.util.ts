import type { NotificationType } from '@prisma/client';

export interface PushText {
  title: string;
  body: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Construit le titre/corps d'une notification push à partir de son type —
 * miroir de describe() dans frontend/src/components/chat/NotificationsPanel.tsx
 * (étendu avec les cas qui y manquaient : MENTION/ADDED_TO_GROUP/
 * REMOVED_FROM_GROUP/PROMOTED_ADMIN/CONTACT_ACCEPTED), pour rester cohérent
 * entre notification in-app et notification système. Volontairement sans
 * résolution de nom d'acteur : le payload ne contient que des IDs, jamais un
 * nom déjà résolu (même limite que describe(), qui n'en affiche pas non
 * plus aujourd'hui) — résoudre un nom ici demanderait une requête
 * supplémentaire pour chaque notification, hors du périmètre de cette passe.
 */
export function buildPushText(type: NotificationType, payload: Record<string, unknown>): PushText {
  const title = 'Glotta';
  switch (type) {
    case 'NEW_MESSAGE':
      return { title, body: str(payload.preview) ?? 'Nouveau message' };
    case 'NEW_VOICE_MESSAGE':
      return { title, body: '🎤 Nouveau message vocal' };
    case 'INCOMING_CALL':
      return { title, body: '📞 Appel entrant' };
    case 'MISSED_CALL':
      return { title, body: '📞 Appel manqué' };
    case 'TRANSLATION_COMPLETED':
      return { title, body: 'Traduction terminée' };
    case 'CONTACT_REQUEST':
      return { title, body: 'Nouvelle demande de contact' };
    case 'CONTACT_ACCEPTED':
      return { title, body: 'Votre demande de contact a été acceptée' };
    case 'REACTION':
      return { title, body: 'Nouvelle réaction à votre message' };
    case 'MENTION':
      return { title, body: 'Vous avez été mentionné(e) dans un groupe' };
    case 'ADDED_TO_GROUP':
      return { title, body: 'Vous avez été ajouté(e) à un groupe' };
    case 'REMOVED_FROM_GROUP':
      return { title, body: "Vous avez été retiré(e) d'un groupe" };
    case 'PROMOTED_ADMIN':
      return { title, body: 'Vous êtes maintenant administrateur(rice) du groupe' };
    default:
      return { title, body: 'Nouvelle notification' };
  }
}

/** URL à ouvrir/focaliser au clic sur la notification système (voir public/sw.js). */
export function buildPushUrl(payload: Record<string, unknown>): string {
  const conversationId = str(payload.conversationId);
  return conversationId ? `/chat?c=${conversationId}` : '/chat';
}
