CREATE TABLE "robots" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "robots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "robot_subsystems" (
    "id" BIGSERIAL NOT NULL,
    "robot_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "robot_subsystems_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tasks" ADD COLUMN "robot_id" BIGINT;
ALTER TABLE "tasks" ADD COLUMN "subsystem_id" BIGINT;

CREATE UNIQUE INDEX "robots_code_key" ON "robots"("code");
CREATE UNIQUE INDEX "robot_subsystems_robot_id_code_key" ON "robot_subsystems"("robot_id", "code");
CREATE INDEX "robot_subsystems_robot_id_idx" ON "robot_subsystems"("robot_id");
CREATE INDEX "tasks_robot_id_idx" ON "tasks"("robot_id");
CREATE INDEX "tasks_subsystem_id_idx" ON "tasks"("subsystem_id");

ALTER TABLE "robot_subsystems"
  ADD CONSTRAINT "robot_subsystems_robot_id_fkey"
  FOREIGN KEY ("robot_id") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_robot_id_fkey"
  FOREIGN KEY ("robot_id") REFERENCES "robots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_subsystem_id_fkey"
  FOREIGN KEY ("subsystem_id") REFERENCES "robot_subsystems"("id") ON DELETE SET NULL ON UPDATE CASCADE;
