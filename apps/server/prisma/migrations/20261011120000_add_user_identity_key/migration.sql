-- PRD 17.12: Ed25519 public key bound to each identity on first signed join
-- (NULL = not bound yet). Additive; no backfill.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "publicKey" TEXT,
ADD COLUMN     "publicKeyBoundAt" TIMESTAMP(3);
