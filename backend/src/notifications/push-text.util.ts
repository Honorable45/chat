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
 * entre notification in-app et notification système.
 *
 * `payload.actorName` est déjà résolu et gravé dans le payload stocké par
 * NotificationsService.create() (voir ACTOR_FIELD_BY_TYPE) — jamais résolu
 * ici : une fonction pure ne doit pas dépendre de Prisma, et une notification
 * système déjà livrée ne pourrait de toute façon plus aller chercher un nom
 * a posteriori. Absent pour les types sans acteur identifiable
 * (TRANSLATION_COMPLETED, ADDED_TO_GROUP...) : titre générique dans ce cas.
 */
// Types dont le texte pousserait autrement un aperçu du contenu échangé
// (message texte ou vocal) — les autres (appel, contact, réaction...) ne
// révèlent déjà qu'une action, jamais un contenu, donc restent inchangés
// même quand hideContent est actif.
const CONTENT_BEARING_TYPES = new Set<NotificationType>(['NEW_MESSAGE', 'NEW_VOICE_MESSAGE']);

export function buildPushText(
  type: NotificationType,
  payload: Record<string, unknown>,
  // Section 9 : "prévoir une option permettant de choisir si le contenu des
  // notifications doit être masqué" — réglage de préférence (Profile du
  // destinataire), indépendant de tout verrouillage local de l'app (jamais
  // connu du backend, voir section 10). Ne touche que le texte poussé ;
  // Notification.payload stocké en base reste toujours complet (lu par le
  // panneau in-app une fois l'app ouverte).
  hideContent = false,
): PushText {
  if (hideContent && CONTENT_BEARING_TYPES.has(type)) {
    return { title: 'Glotta', body: 'Nouveau message' };
  }
  const title = str(payload.actorName) ?? 'Glotta';
  switch (type) {
    case 'NEW_MESSAGE':
      return { title, body: str(payload.preview) ?? 'Nouveau message' };
    case 'NEW_VOICE_MESSAGE':
      return { title, body: '🎤 Message vocal' };
    case 'INCOMING_CALL':
      return { title, body: '📞 Appel entrant' };
    case 'MISSED_CALL':
      return { title, body: '📞 Appel manqué' };
    case 'TRANSLATION_COMPLETED':
      return { title, body: 'Traduction terminée' };
    case 'CONTACT_REQUEST':
      return { title, body: 'Souhaite vous ajouter en contact' };
    case 'CONTACT_ACCEPTED':
      return { title, body: 'A accepté votre demande de contact' };
    case 'REACTION':
      return { title, body: 'A réagi à votre message' };
    case 'MENTION':
      return { title, body: 'Vous a mentionné(e) dans un groupe' };
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
