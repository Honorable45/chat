import { Injectable } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import * as bcrypt from 'bcrypt';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

const SUBSCRIBE_CANDIDATES_LIMIT = 100; // même logique que PASSWORD_RESET_CANDIDATES_LIMIT (AuthService) : seul le hash du jeton est stocké, jamais de lookup direct possible.

/**
 * Namespace dédié à la liaison Glotta Web par QR (section 9) — volontairement
 * SANS authentification à la connexion (contrairement à EventsGateway/
 * CallsGateway) : le navigateur qui affiche le QR n'a par définition encore
 * aucune session. La sécurité vient du jeton lui-même (aléatoire, à usage
 * unique, jamais stocké en clair côté serveur — voir DeviceLinkService),
 * jamais de la connexion socket.
 *
 * @SkipThrottle() : le ThrottlerGuard global (HTTP) ne sait pas gérer un
 * contexte WebSocket — voir le commentaire équivalent sur CallsGateway.
 * Sans lui, chaque message plante silencieusement (`res.header is not a
 * function`, le guard tentant de poser un en-tête HTTP sur une socket).
 */
@Injectable()
@SkipThrottle()
@WebSocketGateway({
  namespace: '/device-link',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class DeviceLinkGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  /** Le navigateur rejoint la room de sa propre demande — ne révèle jamais si un jeton existe ou non au-delà d'un simple {ok:false}. */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { token?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.token) return { ok: false };
    const candidates = await this.prisma.webLinkRequest.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: SUBSCRIBE_CANDIDATES_LIMIT,
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(body.token, candidate.tokenHash)) {
        await client.join(this.room(candidate.id));
        return { ok: true };
      }
    }
    return { ok: false };
  }

  emitConfirmed(requestId: string, payload: unknown): void {
    this.server.to(this.room(requestId)).emit('link:confirmed', payload);
  }

  emitCancelled(requestId: string): void {
    this.server.to(this.room(requestId)).emit('link:cancelled', {});
  }

  private room(requestId: string): string {
    return `link:${requestId}`;
  }
}
