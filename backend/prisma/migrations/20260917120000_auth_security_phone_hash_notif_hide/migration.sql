-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'CHANGE_PHONE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phoneHash" TEXT;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "hideNotificationContent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneHash_key" ON "users"("phoneHash");
