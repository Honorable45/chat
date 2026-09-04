import { forwardRef, Module } from '@nestjs/common';
import { WebsocketModule } from '../websocket/websocket.module';
import { PresenceService } from './presence.service';

// Dépendance circulaire assumée avec WebsocketModule (EventsGateway déclenche
// PresenceService sur connexion/déconnexion ; PresenceService diffuse via
// EventsGateway) — résolue par forwardRef() des deux côtés, motif standard
// NestJS pour ce cas exact.
@Module({
  imports: [forwardRef(() => WebsocketModule)],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
