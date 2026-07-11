ALTER TABLE "cots_items"
ADD COLUMN IF NOT EXISTS "system_id" INTEGER,
ADD COLUMN IF NOT EXISTS "robot_id" BIGINT,
ADD COLUMN IF NOT EXISTS "subsystem_id" BIGINT,
ADD COLUMN IF NOT EXISTS "collected_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "is_collected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "collected_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "note" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cots_items_system_id_fkey'
  ) THEN
    ALTER TABLE "cots_items"
    ADD CONSTRAINT "cots_items_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "systems"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cots_items_robot_id_fkey'
  ) THEN
    ALTER TABLE "cots_items"
    ADD CONSTRAINT "cots_items_robot_id_fkey"
    FOREIGN KEY ("robot_id") REFERENCES "robots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cots_items_subsystem_id_fkey'
  ) THEN
    ALTER TABLE "cots_items"
    ADD CONSTRAINT "cots_items_subsystem_id_fkey"
    FOREIGN KEY ("subsystem_id") REFERENCES "robot_subsystems"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "cots_items_system_id_idx" ON "cots_items"("system_id");
CREATE INDEX IF NOT EXISTS "cots_items_robot_id_idx" ON "cots_items"("robot_id");
CREATE INDEX IF NOT EXISTS "cots_items_subsystem_id_idx" ON "cots_items"("subsystem_id");
CREATE INDEX IF NOT EXISTS "cots_items_is_collected_idx" ON "cots_items"("is_collected");
