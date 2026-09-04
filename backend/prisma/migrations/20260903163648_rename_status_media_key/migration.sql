/*
  Warnings:

  - You are about to drop the column `mediaUrl` on the `statuses` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "statuses" DROP COLUMN "mediaUrl",
ADD COLUMN     "mediaStorageKey" TEXT;
