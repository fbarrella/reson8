-- CreateEnum
CREATE TYPE "IdentityEventKind" AS ENUM ('BOUND', 'RESET', 'REFUSED');

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "requireSignedIdentity" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "identity_events" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "kind" "IdentityEventKind" NOT NULL,
    "reason" TEXT,
    "fingerprint" TEXT,
    "address" TEXT,
    "host" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_events_serverId_createdAt_idx" ON "identity_events"("serverId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "identity_events_userId_createdAt_idx" ON "identity_events"("userId", "createdAt" DESC);

