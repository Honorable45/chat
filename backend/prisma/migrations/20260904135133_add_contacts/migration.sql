-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'CONTACT_SHARE';

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'PENDING',
    "blockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_contacts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sharedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_requests_recipientId_status_idx" ON "contact_requests"("recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_requests_requesterId_recipientId_key" ON "contact_requests"("requesterId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "shared_contacts_messageId_key" ON "shared_contacts"("messageId");

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_contacts" ADD CONSTRAINT "shared_contacts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_contacts" ADD CONSTRAINT "shared_contacts_sharedUserId_fkey" FOREIGN KEY ("sharedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
