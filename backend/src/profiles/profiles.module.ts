import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ProfilesService } from './profiles.service';
import { UserAvatarController } from './user-avatar.controller';

// Pas de contrôleur pour le reste du profil : les endpoints sont exposés
// sous /users/me/profile par UsersController (une seule surface "mon
// compte" pour le frontend), qui délègue ici. Seul l'avatar a son propre
// contrôleur (UserAvatarController) : il doit rester public, contrairement
// à tout le reste de UsersController (voir son commentaire).
@Module({
  imports: [UploadsModule],
  controllers: [UserAvatarController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
