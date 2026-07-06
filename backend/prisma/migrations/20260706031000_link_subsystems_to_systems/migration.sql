ALTER TABLE "robot_subsystems" ADD COLUMN "system_id" INTEGER;

CREATE INDEX "robot_subsystems_system_id_idx" ON "robot_subsystems"("system_id");

ALTER TABLE "robot_subsystems"
  ADD CONSTRAINT "robot_subsystems_system_id_fkey"
  FOREIGN KEY ("system_id") REFERENCES "systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;
