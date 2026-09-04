/*
  Warnings:

  - You are about to drop the column `translatedAudioUrl` on the `message_translations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "message_translations" DROP COLUMN "translatedAudioUrl",
ADD COLUMN     "translatedAudioStorageKey" TEXT;
