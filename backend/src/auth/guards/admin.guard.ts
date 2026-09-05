import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * À poser APRÈS `JwtAuthGuard` (`@UseGuards(JwtAuthGuard, AdminGuard)`) sur
 * toute route réservée à un administrateur — voir AdminModule. Relit
 * toujours `role`/`isActive` en base à chaque requête, jamais depuis un
 * claim JWT mis en cache : le payload du token (`JwtPayload`) ne porte que
 * `{sub, sessionId}` et ne sera jamais enrichi d'un rôle, exactement comme
 * la révocation de session est déjà vérifiée en base plutôt que dans le
 * token (voir AuthService.refresh) — un rôle retiré doit prendre effet
 * immédiatement, pas seulement après l'expiration de l'access token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { role: true, isActive: true },
    });
    if (!user || !user.isActive || user.role !== 'ADMIN') {
      throw new ForbiddenException('Réservé aux administrateurs.');
    }
    return true;
  }
}
