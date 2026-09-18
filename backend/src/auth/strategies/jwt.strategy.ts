import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../auth-cookies.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';
import { assertSessionActive } from '../session-validation.util';

/** Cookie httpOnly en plus de l'en-tête Authorization (audit de sécurité,
 * migration frontend) — jamais l'inverse : le mobile continue d'utiliser
 * exclusivement l'en-tête, aucun cookie n'est jamais posé pour lui. */
function cookieExtractor(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_TOKEN_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    await assertSessionActive(this.prisma, payload.sessionId, payload.sub);
    return { userId: payload.sub, sessionId: payload.sessionId };
  }
}
