-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "dmId" TEXT,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");

-- CreateIndex
CREATE INDEX "attachments_dmId_idx" ON "attachments"("dmId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_dmId_fkey" FOREIGN KEY ("dmId") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (PRD 16.10): every existing single attachment becomes position 0 of
-- its message/DM. URLs and public_ids are copied as stored (legacy absolute
-- URLs included, so existing messages display exactly as before).
--
-- The old Message/DirectMessage.attachmentUrl / attachmentPublicId columns are
-- deliberately KEPT (expand/contract): nothing writes or reads them any more,
-- but a rollback of the server stays non-destructive. Dropping them is a
-- future cleanup.
INSERT INTO "attachments" ("id", "messageId", "url", "publicId", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", "attachmentUrl", "attachmentPublicId", 0, "createdAt"
FROM "messages" WHERE "attachmentUrl" IS NOT NULL;

INSERT INTO "attachments" ("id", "dmId", "url", "publicId", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", "attachmentUrl", "attachmentPublicId", 0, "createdAt"
FROM "direct_messages" WHERE "attachmentUrl" IS NOT NULL;
