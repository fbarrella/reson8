-- AlterEnum
ALTER TYPE "StoredFileKind" ADD VALUE 'SERVER_ICON';

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "iconPublicId" TEXT,
ADD COLUMN     "iconUrl" TEXT;
