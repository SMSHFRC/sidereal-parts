-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'post_processing';

-- DropIndex
DROP INDEX "user_points_ledger_task_id_user_id_key";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "post_processor_id" BIGINT;

-- CreateIndex
CREATE INDEX "tasks_post_processor_id_idx" ON "tasks"("post_processor_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_points_ledger_task_id_user_id_reason_key" ON "user_points_ledger"("task_id", "user_id", "reason");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_post_processor_id_fkey" FOREIGN KEY ("post_processor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

