import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LanguagesModule } from '../languages/languages.module';
import { PresenceModule } from '../presence/presence.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { TranslationsModule } from '../translations/translations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AuthModule fournit AuthModuleOptions, requis par JwtAuthGuard (voir le
  // commentaire dans auth.module.ts). TranslationsModule fournit
  // VoiceIdentityService (inscription/suppression du modèle vocal cloné,
  // exposée ici sous /users/me/voice-model — même principe que le profil,
  // section "une seule surface /users/me pour le frontend").
  imports: [AuthModule, LanguagesModule, ProfilesModule, PresenceModule, TranslationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
