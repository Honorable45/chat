-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'MEDIA_ALBUM';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" "AttachmentType" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "width" INTEGER;
