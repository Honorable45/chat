import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionType, type WebLinkRequest } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, DeviceContext, toSafeUser } from '../auth.service';
import { CreateWebLinkRequestDto } from '../dto/device-link.dto';
import { DeviceLinkGateway } from './device-link.gateway';

const LINK_TOKEN_HASH_ROUNDS = 10;
const LINK_TTL_MS = 90 * 1000; // "expire rapidement" (section 6) — un QR périmé oblige simplement à en réafficher un nouveau côté web.
const FIND_CANDIDATES_LIMIT = 100; // même logique que DeviceLinkGateway.SUBSCRIBE_CANDIDATES_LIMIT.

export interface ScannedLinkInfo {
  browserName: string | null;
  operatingSystem: string | null;
  requestedAt: Date;
}

/**
 * Liaison Glotta Web par QR (sections 6-9) — le jeton embarqué dans le QR
 * n'est JAMAIS stocké en clair (`tokenHash` uniquement, même logique que les
 * refresh tokens/mots de passe) : createLinkRequest() le renvoie une seule
 * fois à l'appelant, qui est seul à le connaître ensuite (le navigateur qui
 * l'a créé, et le mobile qui l'a scanné).
 */
@Injectable()
export class DeviceLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly gateway: DeviceLinkGateway,
  ) {}

  async createLinkRequest(
    dto: CreateWebLinkRequestDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    // Défense en profondeur (section 5) — un User-Agent se falsifie
    // trivialement, ce n'est jamais la vraie frontière de sécurité (qui
    // reste la confirmation explicite côté mobile, section 8-9), mais rien
    // n'empêche de refuser ce cas évident tôt plutôt que d'afficher un QR
    // qui n'a de toute façon aucun sens à scanner depuis le même appareil.
    if (userAgent && /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
      throw new BadRequestException(
        'Glotta Web est disponible uniquement sur ordinateur. Utilisez l’application mobile Glotta.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(token, LINK_TOKEN_HASH_ROUNDS);
    const request = await this.prisma.webLinkRequest.create({
      data: {
        tokenHash,
        browserName: dto.browserName,
        operatingSystem: dto.operatingSystem,
        ipAddress,
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
      },
    });
    return { token, expiresAt: request.expiresAt };
  }

  /** Appelé après le scan (section 7) — renvoie de quoi afficher l'écran de confirmation (section 8), ne modifie rien. */
  async scan(token: string): Promise<ScannedLinkInfo> {
    const request = await this.findPendingByToken(token);
    return {
      browserName: request.browserName,
      operatingSystem: request.operatingSystem,
      requestedAt: request.createdAt,
    };
  }

  /**
   * Confirmation explicite (section 8-9) — la session Web n'est créée
   * QUE si `decision === 'confirm'` ; sinon la demande est simplement
   * invalidée (section 6 : "invalidé après refus"), jamais de session.
   */
  async confirm(
    userId: string,
    token: string,
    decision: 'confirm' | 'cancel',
    deviceLabel: string | undefined,
    context: DeviceContext,
  ): Promise<void> {
    const request = await this.findPendingByToken(token);

    if (decision === 'cancel') {
      await this.prisma.webLinkRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED' },
      });
      this.gateway.emitCancelled(request.id);
      return;
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const tokens = await this.auth.createSession(
      user,
      { ...context, deviceLabel: deviceLabel ?? request.browserName ?? undefined },
      SessionType.WEB,
    );
    await this.prisma.webLinkRequest.update({
      where: { id: request.id },
      data: { status: 'CONFIRMED', userId, confirmedAt: new Date() },
    });
    // Jamais de token permanent dans le QR (section 9) : les tokens ne
    // transitent qu'ici, par ce WebSocket, directement vers le navigateur
    // qui a créé la demande — jamais via l'API REST elle-même.
    this.gateway.emitConfirmed(request.id, { ...tokens, user: toSafeUser(user) });
  }

  private async findPendingByToken(token: string): Promise<WebLinkRequest> {
    const candidates = await this.prisma.webLinkRequest.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: FIND_CANDIDATES_LIMIT,
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(token, candidate.tokenHash)) return candidate;
    }
    throw new NotFoundException('Demande de liaison introuvable ou expirée.');
  }
}
