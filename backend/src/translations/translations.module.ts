import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { VoiceTranslationPipelineService } from './pipeline/voice-translation-pipeline.service';
import { SpeechToTextService } from './speech-to-text/speech-to-text.service';
import { TextToSpeechService } from './text-to-speech/text-to-speech.service';
import { TranslationService } from './translation/translation.service';
import { VoiceIdentityService } from './voice-identity/voice-identity.service';

@Module({
  imports: [UploadsModule, WebsocketModule],
  providers: [
    SpeechToTextService,
    TranslationService,
    TextToSpeechService,
    VoiceIdentityService,
    VoiceTranslationPipelineService,
  ],
  exports: [
    SpeechToTextService,
    TranslationService,
    TextToSpeechService,
    VoiceIdentityService,
    VoiceTranslationPipelineService,
  ],
})
export class TranslationsModule {}
