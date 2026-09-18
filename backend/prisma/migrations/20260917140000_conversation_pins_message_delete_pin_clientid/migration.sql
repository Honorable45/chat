-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_clientId_key" ON "messages"("clientId");

-- CreateTable
CREATE TABLE "message_deletions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_deletions_messageId_userId_key" ON "message_deletions"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
