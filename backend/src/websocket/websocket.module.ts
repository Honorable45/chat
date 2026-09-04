import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PresenceModule } from '../presence/presence.module';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [
    // Secret passé explicitement à chaque verify (voir EventsGateway) — même
    // logique que AuthModule, pas de secret par défaut ici.
    JwtModule.register({}),
    // Voir le commentaire dans presence.module.ts : dépendance circulaire
    // assumée, résolue par forwardRef() des deux côtés.
    forwardRef(() => PresenceModule),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketModule {}
