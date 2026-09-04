import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** À poser sur toute route qui exige un access token valide. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
