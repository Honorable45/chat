-- AlterTable
ALTER TABLE "message_translations" ADD COLUMN     "translatedAudioStorageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "voice_messages" ADD COLUMN     "audioStorageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL';

