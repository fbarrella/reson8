-- AlterTable
ALTER TABLE "direct_messages" ADD COLUMN     "replyToId" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "replyToId" TEXT;

-- replyToId is intentionally a plain column, NOT a foreign key (PRD 16.11): with
-- ON DELETE SET NULL, deleting the original message would erase the fact that
-- the reply WAS a reply, and the client shows "Original message was deleted".
-- Additive and nullable, so existing rows need no backfill.
