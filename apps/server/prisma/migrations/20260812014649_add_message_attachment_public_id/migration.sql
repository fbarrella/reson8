-- AlterTable
ALTER TABLE "direct_messages" ADD COLUMN     "attachmentPublicId" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "attachmentPublicId" TEXT;
