/*
  Warnings:

  - You are about to drop the column `audioUrl` on the `voice_messages` table. All the data in the column will be lost.
  - Added the required column `audioStorageKey` to the `voice_messages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "voice_messages" DROP COLUMN "audioUrl",
ADD COLUMN     "audioStorageKey" TEXT NOT NULL;
