-- M4/M5 shop master data refresh.
-- Keep old referenced rows in place, but hide obsolete options from new task forms.

UPDATE "manufacturing_methods"
SET "is_active" = false
WHERE "code" NOT IN ('CNC', 'LATHE', 'MANUAL_MILL', 'LASER', 'CUTOFF', '3DP');

INSERT INTO "manufacturing_methods" ("code", "name", "is_active") VALUES
  ('CNC', 'CNC Router', true),
  ('LATHE', '車床', true),
  ('MANUAL_MILL', '手動銑床', true),
  ('LASER', '雷切機', true),
  ('CUTOFF', '切斷機', true),
  ('3DP', '3D 列印', true)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "is_active" = EXCLUDED."is_active";

UPDATE "materials"
SET "is_active" = false
WHERE "code" NOT IN (
  'PLA',
  'ABS',
  'PACF',
  'MDF_3MM',
  'MDF_6MM',
  'SRPP_6MM',
  'PC_3MM',
  'PC_6MM',
  'AL6061_PLATE_3MM',
  'AL6061_PLATE_5MM',
  'HEX_SHAFT_0_5IN',
  'ROUND_SHAFT_10MM',
  'ROUND_SHAFT_15MM'
);

INSERT INTO "materials" ("code", "name", "is_active") VALUES
  ('PLA', 'PLA', true),
  ('ABS', 'ABS', true),
  ('PACF', 'PA-CF', true),
  ('MDF_3MM', '密集板 3mm', true),
  ('MDF_6MM', '密集板 6mm', true),
  ('SRPP_6MM', 'SRPP 6mm', true),
  ('PC_3MM', 'PC 3mm', true),
  ('PC_6MM', 'PC 6mm', true),
  ('AL6061_PLATE_3MM', '6061 鋁板 3mm', true),
  ('AL6061_PLATE_5MM', '6061 鋁板 5mm', true),
  ('HEX_SHAFT_0_5IN', '六角軸 1/2in', true),
  ('ROUND_SHAFT_10MM', '圓軸 10mm', true),
  ('ROUND_SHAFT_15MM', '圓軸 15mm', true)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "is_active" = EXCLUDED."is_active";

UPDATE "post_processes"
SET "is_active" = false
WHERE "code" NOT IN ('TAP', 'CHAMFER');

INSERT INTO "post_processes" ("code", "name", "is_active") VALUES
  ('TAP', '攻牙', true),
  ('CHAMFER', '倒角', true)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "is_active" = EXCLUDED."is_active";
