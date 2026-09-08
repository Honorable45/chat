-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'LOCATION';

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'STICKER';

-- CreateTable
CREATE TABLE "location_messages" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_stickers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_stickers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "location_messages_messageId_key" ON "location_messages"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_stickers_userId_emoji_key" ON "favorite_stickers"("userId", "emoji");

-- AddForeignKey
ALTER TABLE "location_messages" ADD CONSTRAINT "location_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_stickers" ADD CONSTRAINT "favorite_stickers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
