-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'GROUP_CALL';

-- CreateEnum
CREATE TYPE "GroupCallStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "GroupCallParticipantStatus" AS ENUM ('RINGING', 'JOINED', 'DECLINED', 'LEFT');

-- CreateTable
CREATE TABLE "group_calls" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "type" "CallType" NOT NULL DEFAULT 'AUDIO',
    "status" "GroupCallStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "group_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_call_participants" (
    "id" TEXT NOT NULL,
    "groupCallId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GroupCallParticipantStatus" NOT NULL DEFAULT 'RINGING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "group_call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_calls_messageId_key" ON "group_calls"("messageId");

-- CreateIndex
CREATE INDEX "group_calls_conversationId_status_idx" ON "group_calls"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_call_participants_groupCallId_userId_key" ON "group_call_participants"("groupCallId", "userId");

-- AddForeignKey
ALTER TABLE "group_calls" ADD CONSTRAINT "group_calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_calls" ADD CONSTRAINT "group_calls_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_calls" ADD CONSTRAINT "group_calls_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_call_participants" ADD CONSTRAINT "group_call_participants_groupCallId_fkey" FOREIGN KEY ("groupCallId") REFERENCES "group_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_call_participants" ADD CONSTRAINT "group_call_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
