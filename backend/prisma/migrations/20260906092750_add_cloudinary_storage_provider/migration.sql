-- CreateEnum
CREATE TYPE "MediaStorageProvider" AS ENUM ('LOCAL', 'CLOUDINARY');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "storageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "avatarStorageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "statuses" ADD COLUMN     "mediaStorageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'LOCAL';
