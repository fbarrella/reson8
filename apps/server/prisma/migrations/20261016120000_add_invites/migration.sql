-- AlterTable
ALTER TABLE "pending_approvals" ADD COLUMN     "inviteId" TEXT;

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "requireInvite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "label" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_uses" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invites_codeHash_key" ON "invites"("codeHash");

-- CreateIndex
CREATE INDEX "invites_serverId_createdAt_idx" ON "invites"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "invite_uses_inviteId_idx" ON "invite_uses"("inviteId");

-- AddForeignKey
ALTER TABLE "invite_uses" ADD CONSTRAINT "invite_uses_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

