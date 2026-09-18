import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parse as parseCookies } from 'cookie';
import type { Socket } from 'socket.io';
import { ACCESS_TOKEN_COOKIE_NAME } from '../auth/auth-cookies.util';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { assertSessionActive } from '../auth/session-validation.util';

/**
 * Authentifie une connexion WebSocket entrante à partir du token JWT d'accès
 * — même logique de bout en bout (token en `auth.token`, en en-tête
 * `Authorization`, ou dans le cookie httpOnly posé par login/refresh, même
 * secret) que EventsGateway, extraite ici pour être réutilisée telle quelle
 * par tout gateway supplémentaire (ex. CallsGateway, namespace "/calls")
 * sans risquer une divergence entre deux copies.
 *
 * Vérifie aussi en base que la session référencée par le token est toujours
 * active (voir assertSessionActive) — sans quoi un token signé resterait
 * accepté pour ouvrir de nouvelles connexions même après logout/révocation,
 * exactement comme pour les requêtes HTTP (voir JwtStrategy).
 *
 * Lève une erreur si aucun token n'est fourni ou s'il est invalide —
 * à charge de l'appelant de déconnecter le socket (voir handleConnection
 * des gateways concernés).
 */
export async function verifySocketUserId(
  client: Socket,
  jwt: JwtService,
  config: ConfigService,
  prisma: PrismaService,
): Promise<string> {
  const authToken = client.handshake.auth?.token as string | undefined;
  const header = client.handshake.headers.authorization;
  const headerToken = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
  const cookieHeader = client.handshake.headers.cookie;
  const cookieToken =
    typeof cookieHeader === 'string'
      ? parseCookies(cookieHeader)[ACCESS_TOKEN_COOKIE_NAME]
      : undefined;
  const token = authToken ?? headerToken ?? cookieToken;
  if (!token) {
    throw new Error('Aucun token fourni pour la connexion WebSocket.');
  }
  const payload = await jwt.verifyAsync<JwtPayload>(token, {
    secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
  });
  await assertSessionActive(prisma, payload.sessionId, payload.sub);
  return payload.sub;
}
