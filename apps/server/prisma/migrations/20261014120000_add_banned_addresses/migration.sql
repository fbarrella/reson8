-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastAddress" TEXT,
ADD COLUMN     "lastAddressAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "banned_addresses" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "linkedUserId" TEXT,
    "nickname" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banned_addresses_serverId_cidr_key" ON "banned_addresses"("serverId", "cidr");

