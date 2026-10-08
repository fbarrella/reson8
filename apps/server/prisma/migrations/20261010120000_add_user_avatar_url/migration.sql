-- PRD 17.1: server-built avatar URL per user (NULL = default avatar).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT;
