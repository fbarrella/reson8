-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "requireApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pending_approvals" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "address" TEXT,
    "host" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_approvals_serverId_requestedAt_idx" ON "pending_approvals"("serverId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pending_approvals_serverId_userId_key" ON "pending_approvals"("serverId", "userId");

