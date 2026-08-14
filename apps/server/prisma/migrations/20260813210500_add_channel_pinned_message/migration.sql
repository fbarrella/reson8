-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "pinnedMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "channels_pinnedMessageId_key" ON "channels"("pinnedMessageId");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_pinnedMessageId_fkey" FOREIGN KEY ("pinnedMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
