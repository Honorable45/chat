import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vérifie qu'une session référencée par un JWT (access ou WebSocket) est
 * TOUJOURS valide : existe, appartient bien à l'utilisateur porté par le
 * token, n'a jamais été révoquée, n'est pas expirée, et que le compte
 * associé est actif.
 *
 * Sans ce contrôle (l'état avant ce correctif — voir JwtStrategy/
 * verifySocketUserId), un access token signé restait accepté jusqu'à sa
 * propre expiration (15 min par défaut) même après logout, révocation de
 * session, changement de mot de passe (qui révoque les autres sessions) ou
 * désactivation du compte : un JWT n'est qu'une PREUVE de possession du
 * secret de signature au moment de l'émission, jamais une preuve que la
 * session qu'il référence est toujours active — ce contrôle en base est ce
 * qui referme cet écart, au prix d'une requête indexée (PK) par requête/
 * connexion authentifiée.
 */
export async function assertSessionActive(
  prisma: PrismaService,
  sessionId: string,
  userId: string,
): Promise<void> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { user: { select: { isActive: true } } },
  });
  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt !== null ||
    session.expiresAt < new Date() ||
    !session.user.isActive
  ) {
    throw new UnauthorizedException('Session invalide ou expirée.');
  }
}
