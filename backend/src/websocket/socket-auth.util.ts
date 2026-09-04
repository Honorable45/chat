import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Authentifie une connexion WebSocket entrante à partir du token JWT d'accès
 * — même logique de bout en bout (token en `auth.token` ou en en-tête
 * `Authorization`, même secret) que EventsGateway, extraite ici pour être
 * réutilisée telle quelle par tout gateway supplémentaire (ex. CallsGateway,
 * namespace "/calls") sans risquer une divergence entre deux copies.
 *
 * Lève une erreur si aucun token n'est fourni ou s'il est invalide —
 * à charge de l'appelant de déconnecter le socket (voir handleConnection
 * des gateways concernés).
 */
export async function verifySocketUserId(
  client: Socket,
  jwt: JwtService,
  config: ConfigService,
): Promise<string> {
  const authToken = client.handshake.auth?.token as string | undefined;
  const header = client.handshake.headers.authorization;
  const headerToken = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
  const token = authToken ?? headerToken;
  if (!token) {
    throw new Error('Aucun token fourni pour la connexion WebSocket.');
  }
  const payload = await jwt.verifyAsync<JwtPayload>(token, {
    secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
  });
  return payload.sub;
}
