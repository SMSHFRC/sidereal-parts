-- Complete M3 Onshape import metadata.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "onshape_config" TEXT,
ADD COLUMN IF NOT EXISTS "onshape_revision" TEXT,
ADD COLUMN IF NOT EXISTS "onshape_thumbnail_url" TEXT,
ADD COLUMN IF NOT EXISTS "onshape_image_meta" JSONB,
ADD COLUMN IF NOT EXISTS "import_batch_id" BIGINT;

CREATE TABLE IF NOT EXISTS "onshape_import_batches" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "source_url" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "wvm" TEXT NOT NULL,
    "wvm_id" TEXT NOT NULL,
    "element_id" TEXT NOT NULL,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onshape_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cots_items" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "name" TEXT,
    "part_number" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "material" TEXT,
    "source_document_id" TEXT,
    "source_element_id" TEXT,
    "thumbnail_url" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cots_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "onshape_import_batches_user_id_idx" ON "onshape_import_batches"("user_id");
CREATE INDEX IF NOT EXISTS "onshape_import_batches_document_id_element_id_idx" ON "onshape_import_batches"("document_id", "element_id");
CREATE INDEX IF NOT EXISTS "cots_items_batch_id_idx" ON "cots_items"("batch_id");
CREATE INDEX IF NOT EXISTS "tasks_import_batch_id_idx" ON "tasks"("import_batch_id");
CREATE INDEX IF NOT EXISTS "tasks_onshape_did_onshape_eid_onshape_part_id_idx" ON "tasks"("onshape_did", "onshape_eid", "onshape_part_id");

CREATE UNIQUE INDEX IF NOT EXISTS "tasks_onshape_identity_unique"
ON "tasks"("onshape_did", "onshape_eid", "onshape_part_id", COALESCE("onshape_config", ''))
WHERE "onshape_did" IS NOT NULL
  AND "onshape_eid" IS NOT NULL
  AND "onshape_part_id" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onshape_import_batches_user_id_fkey'
  ) THEN
    ALTER TABLE "onshape_import_batches"
    ADD CONSTRAINT "onshape_import_batches_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cots_items_batch_id_fkey'
  ) THEN
    ALTER TABLE "cots_items"
    ADD CONSTRAINT "cots_items_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "onshape_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_import_batch_id_fkey'
  ) THEN
    ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_import_batch_id_fkey"
    FOREIGN KEY ("import_batch_id") REFERENCES "onshape_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
