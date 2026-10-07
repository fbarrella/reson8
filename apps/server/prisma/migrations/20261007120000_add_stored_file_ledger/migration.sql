-- CreateEnum
CREATE TYPE "StoredFileKind" AS ENUM ('MESSAGE_ATTACHMENT', 'CUSTOM_EMOJI', 'CHANNEL_ICON');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "kind" "StoredFileKind" NOT NULL,
    "ownerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_url_key" ON "stored_files"("url");

-- CreateIndex
CREATE INDEX "stored_files_claimedAt_createdAt_idx" ON "stored_files"("claimedAt", "createdAt");

-- Backfill (PRD 16.8): every file that is ALREADY referenced by a message, DM,
-- custom emoji or channel icon is recorded in the ledger as claimed.
--
-- Local-disk files were stored by the old client as absolute URLs
-- ("http://host:9800/uploads/x.png"); the ledger's canonical form is the
-- host-independent path ("/uploads/x.png"), so those are normalized here.
-- Cloudinary URLs don't match the pattern and pass through unchanged.
--
-- ON CONFLICT DO NOTHING: the same file can legitimately be referenced twice
-- (or twice under different hosts); the first row wins. The release guard in
-- stored-file.service.ts only deletes a file once NOTHING references it.
INSERT INTO "stored_files" ("id", "url", "publicId", "kind", "ownerId", "claimedAt", "createdAt")
SELECT gen_random_uuid()::text, f."url", f."publicId", f."kind"::"StoredFileKind", f."ownerId", f."at", f."at"
FROM (
    SELECT regexp_replace("attachmentUrl", '^https?://[^/]+(/uploads/[^/?#]+).*$', '\1') AS "url",
           "attachmentPublicId" AS "publicId", 'MESSAGE_ATTACHMENT' AS "kind", "userId" AS "ownerId", "createdAt" AS "at"
    FROM "messages" WHERE "attachmentUrl" IS NOT NULL
    UNION ALL
    SELECT regexp_replace("attachmentUrl", '^https?://[^/]+(/uploads/[^/?#]+).*$', '\1'),
           "attachmentPublicId", 'MESSAGE_ATTACHMENT', "senderId", "createdAt"
    FROM "direct_messages" WHERE "attachmentUrl" IS NOT NULL
    UNION ALL
    SELECT regexp_replace("imageUrl", '^https?://[^/]+(/uploads/[^/?#]+).*$', '\1'),
           "imagePublicId", 'CUSTOM_EMOJI', "uploadedBy", "createdAt"
    FROM "custom_emojis"
    UNION ALL
    SELECT regexp_replace("iconUrl", '^https?://[^/]+(/uploads/[^/?#]+).*$', '\1'),
           "iconPublicId", 'CHANNEL_ICON', NULL, "createdAt"
    FROM "channels" WHERE "iconUrl" IS NOT NULL
) AS f
ON CONFLICT ("url") DO NOTHING;
