import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../websocket/events.gateway';

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
]);

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

    const notification = await this.prisma.notification.create({
      data: { userId, type, payload },
    });

    const dto = toNotificationDto(notification);
    this.events.emitToUser(userId, 'notification:new', dto);
    return dto;
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
