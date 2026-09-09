-- AlterTable
ALTER TABLE "location_messages" ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3);
