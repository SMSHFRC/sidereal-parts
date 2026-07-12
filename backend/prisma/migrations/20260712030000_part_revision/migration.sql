-- 版本管理（Revision）：每個零件（part_number）可有多個 revision，只有一個 current
ALTER TABLE "tasks"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "revision_status" TEXT NOT NULL DEFAULT 'current',
ADD COLUMN "superseded_by_id" BIGINT;

-- 放寬單一 part_number 唯一限制，改為 (part_number, revision)
DROP INDEX "tasks_part_number_key";
CREATE UNIQUE INDEX "tasks_part_number_revision_key" ON "tasks"("part_number", "revision");

-- 同一序號可對應多個 revision
DROP INDEX "tasks_part_number_prefix_part_number_seq_key";
CREATE UNIQUE INDEX "tasks_part_number_prefix_part_number_seq_revision_key" ON "tasks"("part_number_prefix", "part_number_seq", "revision");

CREATE INDEX "tasks_part_number_idx" ON "tasks"("part_number");
CREATE INDEX "tasks_revision_status_idx" ON "tasks"("revision_status");
