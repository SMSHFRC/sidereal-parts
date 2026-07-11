-- AlterTable
ALTER TABLE "cots_items" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'cots';

-- AlterTable
ALTER TABLE "onshape_import_batches" ADD COLUMN     "document_name" TEXT;

-- CreateIndex
CREATE INDEX "cots_items_kind_idx" ON "cots_items"("kind");

