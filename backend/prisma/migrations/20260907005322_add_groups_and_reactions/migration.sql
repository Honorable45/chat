-- CreateEnum
CREATE TYPE "GroupPermission" AS ENUM ('ADMIN_ONLY', 'EVERYONE');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('ADMIN', 'MEMBER');

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ADDED_TO_GROUP';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVED_FROM_GROUP';
ALTER TYPE "NotificationType" ADD VALUE 'PROMOTED_ADMIN';

-- DropIndex
DROP INDEX "reactions_messageId_userId_emoji_key";

-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "role" "GroupRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "addMembersPermission" "GroupPermission" NOT NULL DEFAULT 'EVERYONE',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "editInfoPermission" "GroupPermission" NOT NULL DEFAULT 'ADMIN_ONLY',
ADD COLUMN     "photoStorageKey" TEXT,
ADD COLUMN     "photoStorageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "sendMediaPermission" "GroupPermission" NOT NULL DEFAULT 'EVERYONE',
ADD COLUMN     "sendMessagesPermission" "GroupPermission" NOT NULL DEFAULT 'EVERYONE';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "systemAction" TEXT,
ADD COLUMN     "systemTargetUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reactions_messageId_userId_key" ON "reactions"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_systemTargetUserId_fkey" FOREIGN KEY ("systemTargetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

