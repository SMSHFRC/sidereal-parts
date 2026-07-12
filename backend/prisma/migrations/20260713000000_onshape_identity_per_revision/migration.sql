-- 版本管理修正：Onshape 零件身分的唯一索引改為「每個 revision 一筆」。
-- 舊索引（M3 時代）強制一顆 Onshape 零件只能有一筆任務，
-- 導致已完成零件重新匯入要開新 Rev 時撞唯一鍵（P2002）。
DROP INDEX IF EXISTS "tasks_onshape_identity_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "tasks_onshape_identity_revision_unique"
ON "tasks"("onshape_did", "onshape_eid", "onshape_part_id", COALESCE("onshape_config", ''), "revision")
WHERE "onshape_did" IS NOT NULL
  AND "onshape_eid" IS NOT NULL
  AND "onshape_part_id" IS NOT NULL;
