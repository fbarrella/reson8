/*
  Warnings:

  - You are about to drop the column `attachmentUrl` on the `direct_messages` table. All the data in the column will be lost.
  - You are about to drop the column `fromUserId` on the `direct_messages` table. All the data in the column will be lost.
  - You are about to drop the column `roomId` on the `direct_messages` table. All the data in the column will be lost.
  - You are about to drop the column `toUserId` on the `direct_messages` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentUrl` on the `messages` table. All the data in the column will be lost.
  - Added the required column `receiverId` to the `direct_messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `senderId` to the `direct_messages` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_toUserId_fkey";

-- DropIndex
DROP INDEX "direct_messages_roomId_createdAt_idx";

-- AlterTable
ALTER TABLE "direct_messages" DROP COLUMN "attachmentUrl",
DROP COLUMN "fromUserId",
DROP COLUMN "roomId",
DROP COLUMN "toUserId",
ADD COLUMN     "receiverId" TEXT NOT NULL,
ADD COLUMN     "senderId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "attachmentUrl";

-- CreateIndex
CREATE INDEX "direct_messages_senderId_receiverId_createdAt_idx" ON "direct_messages"("senderId", "receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "direct_messages_receiverId_senderId_createdAt_idx" ON "direct_messages"("receiverId", "senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
