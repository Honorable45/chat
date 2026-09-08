import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider } from '../push/push.provider';
import { EventsGateway } from '../websocket/events.gateway';
import { buildPushText, buildPushUrl } from './push-text.util';

// INCOMING_CALL a sa propre sonnerie temps réel (voir CallsGateway, qui
// suppose une connexion WebSocket active) ET, désormais, son propre push
// système avec actions "Répondre"/"Refuser" (voir CallsService.invite →
// PushProvider.sendCallInvite) — mais jamais via CE chemin générique
// (title/body/url) : sa forme (jeton de refus, requireInteraction, tag)
// diffère trop pour partager PushMessage, donc explicitement exclu ici pour
// ne jamais faire doublon avec l'appel dédié fait côté CallsService.
const PUSH_EXCLUDED_TYPES: ReadonlySet<NotificationType> = new Set(['INCOMING_CALL']);

const DEFAULT_PAGE_SIZE = 30;

// Types "message" dont la notification n'a jamais de sens si le
// destinataire a déjà cette conversation précise à l'écran (section 14-18
// du cahier des charges) — volontairement PAS les appels (INCOMING_CALL/
// MISSED_CALL, un appel entrant sonne quel que soit l'écran affiché, voir
// CallsGateway pour la vraie sonnerie temps réel, indépendante de cette
// ligne de notification) ni CONTACT_REQUEST/CONTACT_ACCEPTED (jamais liés
// à une conversation ouverte).
const SUPPRESSIBLE_WHEN_VIEWING_TYPES: ReadonlySet<NotificationType> = new Set([
  'NEW_MESSAGE',
  'NEW_VOICE_MESSAGE',
  'REACTION',
  'MENTION',
]);

// Champ du payload qui porte l'identité de "qui a fait l'action", par type —
// jamais uniforme d'un appelant à l'autre (senderId pour un message, actorId
// pour une mention, userId pour une réaction/un contact...). Types absents
// de cette table (TRANSLATION_COMPLETED, ADDED_TO_GROUP...) : pas d'acteur
// identifiable, le titre générique "Glotta" reste utilisé (voir buildPushText).
const ACTOR_FIELD_BY_TYPE: Partial<Record<NotificationType, string>> = {
  NEW_MESSAGE: 'senderId',
  NEW_VOICE_MESSAGE: 'senderId',
  MENTION: 'actorId',
  REACTION: 'userId',
  CONTACT_REQUEST: 'userId',
  CONTACT_ACCEPTED: 'userId',
  MISSED_CALL: 'callerId',
};

function toNotificationDto(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    payload: notification.payload,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

export type NotificationDto = ReturnType<typeof toNotificationDto>;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly presence: PresenceService,
    private readonly push: PushProvider,
  ) {}

  /**
   * Point d'entrée générique pour tout module qui veut notifier un
   * utilisateur (MessagesModule, VoiceModule, ContactsModule, CallsModule).
   * Ne crée rien si le destinataire a désactivé les notifications (section
   * 11), ni si (pour un type "message", voir SUPPRESSIBLE_WHEN_VIEWING_TYPES)
   * il a déjà cette conversation précise ouverte sur au moins un de ses
   * appareils (section 14-18) — jamais de notification fantôme créée puis
   * cachée côté client dans un cas comme dans l'autre.
   */
  async create(
    userId: string,
    type: NotificationType,
    payload: Prisma.InputJsonObject,
  ): Promise<NotificationDto | null> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (profile?.notificationsEnabled === false) return null;

    const conversationId = payload.conversationId;
    if (
      SUPPRESSIBLE_WHEN_VIEWING_TYPES.has(type) &&
      typeof conversationId === 'string' &&
      this.presence.isViewingConversation(userId, conversationId)
    ) {
      return null;
    }

    const enrichedPayload = await this.withActorName(type, payload);

    const notification = await this.prisma.notification.create({
      data: { userId, type, payload: enrichedPayload },
    });

    const dto = toNotificationDto(notification);
    this.events.emitToUser(userId, 'notification:new', dto);

    // Fire-and-forget (comme le pipeline vocal) : jamais attendu par
    // l'appelant, une erreur d'envoi push ne doit jamais faire échouer la
    // création de la notification elle-même — voir PushProvider.sendToUser,
    // déjà best-effort en interne.
    if (!PUSH_EXCLUDED_TYPES.has(type)) {
      void this.push.sendToUser(userId, {
        ...buildPushText(type, enrichedPayload),
        url: buildPushUrl(enrichedPayload),
      });
    }

    return dto;
  }

  /**
   * Résout et grave le nom de "qui a fait l'action" directement dans le
   * payload stocké (voir ACTOR_FIELD_BY_TYPE) — jamais résolu à la volée au
   * moment de l'affichage : une notification push déjà livrée à un appareil
   * ne peut plus aller chercher un nom après coup, et geler le nom au moment
   * de l'envoi (plutôt que de résoudre l'ID à chaque lecture) évite aussi un
   * aller-retour réseau supplémentaire à chaque ouverture du panneau
   * Notifications. Comme un pseudo Twitter, le nom affiché reste celui
   * d'alors même si l'auteur change ensuite le sien — comportement attendu
   * pour un historique, pas un bug.
   */
  private async withActorName(
    type: NotificationType,
    payload: Prisma.InputJsonObject,
  ): Promise<Prisma.InputJsonObject> {
    const field = ACTOR_FIELD_BY_TYPE[type];
    const actorId = field ? payload[field] : undefined;
    if (typeof actorId !== 'string') return payload;

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true },
    });
    if (!actor) return payload;

    return { ...payload, actorName: `${actor.firstName} ${actor.lastName}`.trim() };
  }

  async list(userId: string, cursor?: string, limit = DEFAULT_PAGE_SIZE) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toNotificationDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    // Vérification d'appartenance stricte (section 23) : jamais marquer lue
    // la notification d'un autre utilisateur en devinant un ID.
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification introuvable.');
    }

    if (notification.readAt) {
      return toNotificationDto(notification); // déjà lue : idempotent
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    return toNotificationDto(updated);
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
