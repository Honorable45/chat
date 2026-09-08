import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactRequest, ContactRequestStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUserDto, UsersService } from '../users/users.service';
import { EventsGateway } from '../websocket/events.gateway';
import { ShareContactDto } from './dto/share-contact.dto';

function toRequestDto(request: ContactRequest, otherUser: PublicUserDto) {
  return {
    id: request.id,
    status: request.status,
    // Toujours le point de vue du destinataire de ce DTO, jamais brut
    // requesterId/recipientId — voir listIncomingRequests/listSentRequests
    // qui construisent ce DTO uniquement dans le bon sens.
    user: otherUser,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export type ContactRequestDto = ReturnType<typeof toRequestDto>;

/** État de la relation entre l'utilisateur courant et un autre — pilote l'affichage du bouton sur une carte de contact/profil. */
export type ContactStatus =
  'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'ACCEPTED' | 'BLOCKED_BY_ME' | 'BLOCKED_BY_THEM';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Envoie une demande de contact. Section 4 du cahier des charges : si
   * l'autre personne avait déjà envoyé une demande PENDING dans l'autre
   * sens, on considère que les deux parties sont d'accord et on accepte
   * directement plutôt que de créer une seconde demande symétrique.
   */
  async sendRequest(requesterId: string, recipientId: string): Promise<ContactRequestDto> {
    if (requesterId === recipientId) {
      throw new BadRequestException('Impossible de vous ajouter vous-même.');
    }
    const recipientProfile = await this.users.getPublicProfile(recipientId); // NotFoundException si inactif/inexistant

    const reverse = await this.prisma.contactRequest.findUnique({
      where: { requesterId_recipientId: { requesterId: recipientId, recipientId: requesterId } },
    });
    if (reverse) {
      if (reverse.status === 'ACCEPTED') {
        throw new ConflictException('Vous êtes déjà en contact.');
      }
      if (reverse.status === 'BLOCKED') {
        throw new ForbiddenException(
          reverse.blockedById === requesterId
            ? 'Débloquez cette personne avant de lui envoyer une demande.'
            : "Impossible d'envoyer une demande à cet utilisateur.",
        );
      }
      if (reverse.status === 'PENDING') {
        // L'autre personne nous avait déjà demandé — on accepte directement.
        const updated = await this.prisma.contactRequest.update({
          where: { id: reverse.id },
          data: { status: 'ACCEPTED' },
        });
        await this.notifications.create(recipientId, 'CONTACT_ACCEPTED', {
          userId: requesterId,
        });
        return toRequestDto(updated, recipientProfile);
      }
      // DECLINED côté inverse : n'empêche pas d'envoyer sa propre demande.
    }

    const existing = await this.prisma.contactRequest.findUnique({
      where: { requesterId_recipientId: { requesterId, recipientId } },
    });
    if (existing) {
      if (existing.status === 'PENDING') {
        throw new ConflictException('Demande déjà envoyée.');
      }
      if (existing.status === 'ACCEPTED') {
        throw new ConflictException('Vous êtes déjà en contact.');
      }
      if (existing.status === 'BLOCKED') {
        throw new ForbiddenException(
          existing.blockedById === requesterId
            ? 'Débloquez cette personne avant de lui envoyer une demande.'
            : "Impossible d'envoyer une demande à cet utilisateur.",
        );
      }
      // DECLINED : on relance en repassant à PENDING plutôt que de dupliquer la ligne.
      const relaunched = await this.prisma.contactRequest.update({
        where: { id: existing.id },
        data: { status: 'PENDING', blockedById: null },
      });
      await this.notifications.create(recipientId, 'CONTACT_REQUEST', { userId: requesterId });
      return toRequestDto(relaunched, recipientProfile);
    }

    const created = await this.prisma.contactRequest.create({
      data: { requesterId, recipientId, status: 'PENDING' },
    });
    await this.notifications.create(recipientId, 'CONTACT_REQUEST', { userId: requesterId });
    return toRequestDto(created, recipientProfile);
  }

  async accept(userId: string, requestId: string): Promise<ContactRequestDto> {
    const request = await this.requireRequest(requestId);
    if (request.recipientId !== userId) {
      throw new ForbiddenException('Cette demande ne vous est pas destinée.');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException("Cette demande n'est plus en attente.");
    }
    const updated = await this.prisma.contactRequest.update({
      where: { id: requestId },
      data: { status: 'ACCEPTED' },
    });
    await this.notifications.create(request.requesterId, 'CONTACT_ACCEPTED', { userId });
    const requesterProfile = await this.users.getPublicProfile(request.requesterId);
    return toRequestDto(updated, requesterProfile);
  }

  async decline(userId: string, requestId: string): Promise<void> {
    const request = await this.requireRequest(requestId);
    if (request.recipientId !== userId) {
      throw new ForbiddenException('Cette demande ne vous est pas destinée.');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException("Cette demande n'est plus en attente.");
    }
    await this.prisma.contactRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED' },
    });
  }

  /** L'auteur d'une demande encore PENDING l'annule — supprime la ligne pour permettre d'en renvoyer une immédiatement. */
  async cancel(userId: string, requestId: string): Promise<void> {
    const request = await this.requireRequest(requestId);
    if (request.requesterId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas à l'origine de cette demande.");
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException("Cette demande n'est plus en attente.");
    }
    await this.prisma.contactRequest.delete({ where: { id: requestId } });
  }

  async block(userId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) {
      throw new BadRequestException('Impossible de vous bloquer vous-même.');
    }
    await this.users.getPublicProfile(targetUserId);
    const existing = await this.findEitherDirection(userId, targetUserId);
    if (existing) {
      await this.prisma.contactRequest.update({
        where: { id: existing.id },
        data: { status: 'BLOCKED', blockedById: userId },
      });
      return;
    }
    await this.prisma.contactRequest.create({
      data: {
        requesterId: userId,
        recipientId: targetUserId,
        status: 'BLOCKED',
        blockedById: userId,
      },
    });
  }

  /** Seule la personne qui a bloqué peut débloquer — supprime la ligne (retour à l'état "aucune relation"). */
  async unblock(userId: string, targetUserId: string): Promise<void> {
    const existing = await this.findEitherDirection(userId, targetUserId);
    if (!existing || existing.status !== 'BLOCKED' || existing.blockedById !== userId) {
      throw new NotFoundException('Aucun blocage à lever.');
    }
    await this.prisma.contactRequest.delete({ where: { id: existing.id } });
  }

  /**
   * Juste les ids, sans hydratation de profil — utilisé par des modules qui
   * n'ont besoin que de savoir "qui est contact de qui" (ex.
   * StatusesService pour la visibilité CONTACTS d'un statut, section 20/28
   * du cahier des charges), jamais l'inverse d'écrire cette logique
   * ailleurs qu'ici.
   */
  async listContactIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.contactRequest.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { recipientId: userId }] },
      select: { requesterId: true, recipientId: true },
    });
    return new Set(rows.map((r) => (r.requesterId === userId ? r.recipientId : r.requesterId)));
  }

  /** Vrai si les deux utilisateurs sont en contact accepté (dans un sens ou l'autre). */
  async areContacts(userIdA: string, userIdB: string): Promise<boolean> {
    const row = await this.findEitherDirection(userIdA, userIdB);
    return row?.status === 'ACCEPTED';
  }

  async listContacts(userId: string): Promise<PublicUserDto[]> {
    const rows = await this.prisma.contactRequest.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { recipientId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const otherIds = rows.map((r) => (r.requesterId === userId ? r.recipientId : r.requesterId));
    return Promise.all(otherIds.map((id) => this.users.getPublicProfile(id)));
  }

  async listIncomingRequests(userId: string): Promise<ContactRequestDto[]> {
    const rows = await this.prisma.contactRequest.findMany({
      where: { recipientId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (r) => toRequestDto(r, await this.users.getPublicProfile(r.requesterId))),
    );
  }

  async listSentRequests(userId: string): Promise<ContactRequestDto[]> {
    const rows = await this.prisma.contactRequest.findMany({
      where: { requesterId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (r) => toRequestDto(r, await this.users.getPublicProfile(r.recipientId))),
    );
  }

  async statusWith(userId: string, otherUserId: string): Promise<{ status: ContactStatus }> {
    if (userId === otherUserId) return { status: 'NONE' };
    const row = await this.findEitherDirection(userId, otherUserId);
    if (!row) return { status: 'NONE' };
    if (row.status === 'ACCEPTED') return { status: 'ACCEPTED' };
    if (row.status === 'BLOCKED') {
      return { status: row.blockedById === userId ? 'BLOCKED_BY_ME' : 'BLOCKED_BY_THEM' };
    }
    if (row.status === 'PENDING') {
      return { status: row.requesterId === userId ? 'PENDING_SENT' : 'PENDING_RECEIVED' };
    }
    return { status: 'NONE' }; // DECLINED : plus aucune relation active
  }

  /**
   * Partage la carte publique d'un utilisateur dans une conversation, sous
   * forme de message de type CONTACT_SHARE. Ne exige pas que `userId` soit
   * déjà un contact accepté de l'expéditeur : partager la carte de
   * quelqu'un avec un tiers est une fonctionnalité à part (comme partager
   * un lien de profil) — seules des informations publiques
   * (UsersService.getPublicProfile) transitent, jamais email/téléphone.
   */
  async shareContact(senderId: string, dto: ShareContactDto) {
    if (dto.userId === senderId) {
      throw new BadRequestException('Impossible de partager votre propre carte ainsi.');
    }
    const sharedProfile = await this.users.getPublicProfile(dto.userId);

    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: dto.conversationId, userId: senderId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }

    const otherMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId: dto.conversationId, userId: { not: senderId }, leftAt: null },
      select: { userId: true },
    });
    const recipients = otherMembers.map((m) => m.userId);

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: dto.conversationId,
          senderId,
          type: 'CONTACT_SHARE',
          sharedContact: { create: { sharedUserId: dto.userId } },
        },
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const dtoOut = this.toContactShareMessageDto(message, sharedProfile);
    this.events.emitToUsers(recipients, 'message:new', dtoOut);
    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.create(recipientId, 'NEW_MESSAGE', {
          conversationId: dto.conversationId,
          messageId: message.id,
          senderId,
          preview: `👤 Contact : ${sharedProfile.firstName} ${sharedProfile.lastName}`,
        }),
      ),
    );
    return dtoOut;
  }

  /** Hydratation à la demande d'un message CONTACT_SHARE chargé depuis l'historique — même principe que GET /calls/message/:messageId. */
  async getByMessageId(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { sharedContact: true },
    });
    if (!message || message.type !== 'CONTACT_SHARE' || !message.sharedContact) {
      throw new NotFoundException('Carte de contact introuvable.');
    }
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId } },
    });
    if (!membership) {
      throw new NotFoundException('Carte de contact introuvable.');
    }
    const sharedProfile = await this.users.getPublicProfile(message.sharedContact.sharedUserId);
    return this.toContactShareMessageDto(message, sharedProfile);
  }

  private toContactShareMessageDto(
    message: {
      id: string;
      conversationId: string;
      senderId: string;
      sentAt: Date;
      createdAt: Date;
    },
    sharedProfile: PublicUserDto,
  ) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: 'CONTACT_SHARE' as const,
      text: null,
      systemAction: null,
      systemTargetUserId: null,
      replyToId: null,
      // Idem : un message CONTACT_SHARE ne peut pas être une réponse
      // aujourd'hui (jamais construit avec un replyToId), mais le champ
      // reste requis côté frontend (Message.replyTo) — toujours présent
      // même null, jamais absent.
      replyTo: null,
      editedAt: null,
      deletedAt: null,
      sentAt: message.sentAt,
      deliveredAt: null,
      readAt: null,
      // Toujours présents même vides (jamais absents) : le frontend
      // (MessageBubble.tsx) les lit sans garde — un message CONTACT_SHARE
      // sans ces 3 champs faisait planter le rendu de la bulle avec "Cannot
      // read properties of undefined" dès qu'un message de ce type
      // apparaissait dans la conversation (bug réel constaté en prod).
      reactions: [],
      mentions: [],
      mentionsEveryone: false,
      attachments: [],
      sharedContact: sharedProfile,
      // Même raison que reactions/mentions ci-dessus : le frontend
      // (Message.location) attend toujours ce champ, même null.
      location: null,
      createdAt: message.createdAt,
    };
  }

  private async requireRequest(requestId: string): Promise<ContactRequest> {
    const request = await this.prisma.contactRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Demande introuvable.');
    return request;
  }

  private findEitherDirection(userIdA: string, userIdB: string) {
    return this.prisma.contactRequest.findFirst({
      where: {
        OR: [
          { requesterId: userIdA, recipientId: userIdB },
          { requesterId: userIdB, recipientId: userIdA },
        ],
      },
    });
  }
}

export type { ContactRequestStatus };
