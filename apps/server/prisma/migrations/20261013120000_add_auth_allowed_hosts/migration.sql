-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "authAllowedHosts" TEXT[] DEFAULT ARRAY[]::TEXT[];

