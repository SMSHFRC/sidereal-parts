-- =========================================================
-- 種子資料 (Seed) — 主檔 + 範例任務
-- 執行順序：schema.sql 之後
-- =========================================================

-- 身分組
INSERT INTO roles (code, name, description) VALUES
  ('designer',  '設計者', '建立並指派加工任務'),
  ('machinist', '加工者', '執行加工並更新狀態'),
  ('admin',     '管理員', '系統管理')
ON CONFLICT (code) DO NOTHING;

-- 使用者（password_hash 請於實際系統以雜湊後填入）
INSERT INTO users (email, display_name, password_hash) VALUES
  ('designer@example.com',  '王設計', '$placeholder$'),
  ('machinist@example.com', '陳加工', '$placeholder$')
ON CONFLICT (email) DO NOTHING;

-- 指派身分組
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE (u.email = 'designer@example.com'  AND r.code = 'designer')
   OR (u.email = 'machinist@example.com' AND r.code = 'machinist')
ON CONFLICT DO NOTHING;

-- 系統（code 同時作為零件編號 prefix）
INSERT INTO systems (code, name) VALUES
  ('ARM', '機械手臂'),
  ('CHS', '底盤系統'),
  ('PWR', '電源模組')
ON CONFLICT (code) DO NOTHING;

-- 加工方式
INSERT INTO manufacturing_methods (code, name) VALUES
  ('CNC',   'CNC 銑削'),
  ('LATHE', '車床'),
  ('3DP',   '3D 列印'),
  ('LASER', '雷射切割')
ON CONFLICT (code) DO NOTHING;

-- 材料
INSERT INTO materials (code, name) VALUES
  ('AL6061', '鋁 6061'),
  ('SUS304', '不鏽鋼 304'),
  ('PLA',    'PLA'),
  ('ABS',    'ABS')
ON CONFLICT (code) DO NOTHING;

-- 後處理
INSERT INTO post_processes (code, name) VALUES
  ('ANODIZE',   '陽極處理'),
  ('SANDBLAST', '噴砂'),
  ('POLISH',    '拋光'),
  ('PAINT',     '烤漆')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------
-- 範例任務（示範完整建立流程：取號 -> 建任務 -> 後處理 -> 歷史）
-- ---------------------------------------------------------
DO $$
DECLARE
  v_designer  BIGINT;
  v_machinist BIGINT;
  v_system    INT;
  v_method    INT;
  v_material  INT;
  v_pn        VARCHAR;
  v_seq       BIGINT;
  v_task      BIGINT;
BEGIN
  SELECT id INTO v_designer  FROM users   WHERE email = 'designer@example.com';
  SELECT id INTO v_machinist FROM users   WHERE email = 'machinist@example.com';
  SELECT id INTO v_system    FROM systems WHERE code = 'ARM';
  SELECT id INTO v_method    FROM manufacturing_methods WHERE code = 'CNC';
  SELECT id INTO v_material  FROM materials WHERE code = 'AL6061';

  -- 取號（ARM-0001）
  v_pn  := next_part_number('ARM');
  v_seq := (SELECT last_value FROM task_number_sequences WHERE prefix = 'ARM');

  INSERT INTO tasks (
    part_number, part_number_prefix, part_number_seq,
    manufacturing_method_id, system_id, designer_id, machinist_id,
    material_id, quantity, drawing_url, dimension, status_code, note
  ) VALUES (
    v_pn, 'ARM', v_seq,
    v_method, v_system, v_designer, v_machinist,
    v_material, 10,
    'https://drive.google.com/example', '100x50x10 mm', 'pending',
    '範例任務'
  )
  RETURNING id INTO v_task;

  -- 後處理：陽極 -> 噴砂
  INSERT INTO task_post_processes (task_id, post_process_id, sort_order)
  SELECT v_task, id, CASE code WHEN 'ANODIZE' THEN 1 ELSE 2 END
  FROM post_processes WHERE code IN ('ANODIZE', 'SANDBLAST');

  -- 初始狀態歷史
  INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, note)
  VALUES (v_task, NULL, 'pending', v_designer, '任務建立');
END $$;
