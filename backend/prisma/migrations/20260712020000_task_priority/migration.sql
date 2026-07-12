ALTER TABLE "tasks"
ADD COLUMN "is_urgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "urgent_by_id" BIGINT,
ADD COLUMN "urgent_at" TIMESTAMP(3),
ADD COLUMN "urgent_reason" TEXT;

CREATE INDEX "tasks_is_urgent_idx" ON "tasks"("is_urgent");
CREATE INDEX "tasks_urgent_by_id_idx" ON "tasks"("urgent_by_id");

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_urgent_by_id_fkey"
FOREIGN KEY ("urgent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
