CREATE TYPE "MethodOccupancy" AS ENUM ('blocking', 'automatic');

ALTER TABLE "manufacturing_methods"
ADD COLUMN IF NOT EXISTS "occupancy" "MethodOccupancy" NOT NULL DEFAULT 'blocking',
ADD COLUMN IF NOT EXISTS "reminder_minutes" INTEGER NOT NULL DEFAULT 30;

UPDATE "manufacturing_methods"
SET "occupancy" = 'automatic', "reminder_minutes" = 240
WHERE "code" = '3DP';

UPDATE "manufacturing_methods"
SET "occupancy" = 'blocking'
WHERE "code" <> '3DP';

ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "status_reminder_snoozed_until" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "last_status_reminder_response" TEXT;

CREATE TABLE IF NOT EXISTS "print_batches" (
  "id" BIGSERIAL NOT NULL,
  "manufacturing_method_id" INTEGER NOT NULL,
  "owner_id" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "print_batch_tasks" (
  "id" BIGSERIAL NOT NULL,
  "batch_id" BIGINT NOT NULL,
  "task_id" BIGINT NOT NULL,
  "added_by" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_batch_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "task_assignment_transfers" (
  "id" BIGSERIAL NOT NULL,
  "task_id" BIGINT NOT NULL,
  "from_assignee_id" BIGINT,
  "to_assignee_id" BIGINT NOT NULL,
  "changed_by" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignment_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "print_batches_manufacturing_method_id_idx" ON "print_batches"("manufacturing_method_id");
CREATE INDEX IF NOT EXISTS "print_batches_owner_id_idx" ON "print_batches"("owner_id");
CREATE INDEX IF NOT EXISTS "print_batches_status_idx" ON "print_batches"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "print_batch_tasks_batch_id_task_id_key" ON "print_batch_tasks"("batch_id", "task_id");
CREATE INDEX IF NOT EXISTS "print_batch_tasks_task_id_idx" ON "print_batch_tasks"("task_id");
CREATE INDEX IF NOT EXISTS "print_batch_tasks_added_by_idx" ON "print_batch_tasks"("added_by");
CREATE INDEX IF NOT EXISTS "task_assignment_transfers_task_id_idx" ON "task_assignment_transfers"("task_id");
CREATE INDEX IF NOT EXISTS "task_assignment_transfers_from_assignee_id_idx" ON "task_assignment_transfers"("from_assignee_id");
CREATE INDEX IF NOT EXISTS "task_assignment_transfers_to_assignee_id_idx" ON "task_assignment_transfers"("to_assignee_id");

ALTER TABLE "print_batches"
ADD CONSTRAINT "print_batches_manufacturing_method_id_fkey"
FOREIGN KEY ("manufacturing_method_id") REFERENCES "manufacturing_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "print_batches"
ADD CONSTRAINT "print_batches_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "print_batch_tasks"
ADD CONSTRAINT "print_batch_tasks_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "print_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "print_batch_tasks"
ADD CONSTRAINT "print_batch_tasks_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_assignment_transfers"
ADD CONSTRAINT "task_assignment_transfers_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_assignment_transfers"
ADD CONSTRAINT "task_assignment_transfers_from_assignee_id_fkey"
FOREIGN KEY ("from_assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_assignment_transfers"
ADD CONSTRAINT "task_assignment_transfers_to_assignee_id_fkey"
FOREIGN KEY ("to_assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_assignment_transfers"
ADD CONSTRAINT "task_assignment_transfers_changed_by_fkey"
FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
