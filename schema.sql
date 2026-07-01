-- =========================================================
-- 零件加工任務管理系統 — Database Schema (PostgreSQL)
-- 設計者 → 加工者 任務流程
-- =========================================================

-- 若要用 UUID 主鍵可啟用：
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 讓 updated_at 自動更新的共用函式
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 1. 身分組 / 使用者
-- =========================================================
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,      -- 'designer','machinist','admin'
  name        VARCHAR(100) NOT NULL,             -- 顯示名稱
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255),                    -- 若走外部登入(OAuth)可為 NULL
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  total_points  BIGINT NOT NULL DEFAULT 0 CHECK (total_points >= 0), -- 累積積分（快取值，來源為明細帳）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 使用者 <-> 身分組（多對多）
CREATE TABLE user_roles (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     INT    NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- =========================================================
-- 2. 主檔（可無限擴充）
-- =========================================================
CREATE TABLE systems (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,       -- 也常拿來當零件編號 prefix，例如 'ARM'
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE manufacturing_methods (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,       -- 'CNC','3DP','LATHE'
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE materials (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,       -- 'AL6061','SUS304'
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE post_processes (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,       -- 'ANODIZE','SANDBLAST'
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- 3. 任務狀態（用查表而非 enum，方便擴充狀態）
-- =========================================================
CREATE TABLE task_statuses (
  code        VARCHAR(30) PRIMARY KEY,            -- 'pending','processing'...
  name        VARCHAR(50) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE      -- 是否為終態(completed/cancelled)
);

INSERT INTO task_statuses (code, name, sort_order, is_terminal) VALUES
  ('pending',    '待接受',   10, FALSE),
  ('accepted',   '已接受',   20, FALSE),
  ('processing', '加工中',   30, FALSE),
  ('completed',  '已完成',   50, TRUE),
  ('cancelled',  '已取消',   70, TRUE);

-- =========================================================
-- 4. 流水號計數器
-- =========================================================
CREATE TABLE task_number_sequences (
  prefix      VARCHAR(50) PRIMARY KEY,            -- 例如 'ARM'
  last_value  BIGINT NOT NULL DEFAULT 0
);

-- 取下一個零件編號（併發安全，靠 UPDATE...RETURNING 行鎖）
CREATE OR REPLACE FUNCTION next_part_number(p_prefix VARCHAR, p_pad INT DEFAULT 4)
RETURNS VARCHAR AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO task_number_sequences (prefix, last_value)
  VALUES (p_prefix, 1)
  ON CONFLICT (prefix)
  DO UPDATE SET last_value = task_number_sequences.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || LPAD(v_next::text, p_pad, '0');
END;
$$ LANGUAGE plpgsql;
-- 用法：SELECT next_part_number('ARM');  ->  ARM-0001

-- =========================================================
-- 5. 任務（核心）
-- =========================================================
CREATE TABLE tasks (
  id                       BIGSERIAL PRIMARY KEY,

  -- 零件編號：prefix-流水號，例如 ARM-0001（全域唯一）
  part_number              VARCHAR(60) NOT NULL UNIQUE,
  part_number_prefix       VARCHAR(50) NOT NULL,
  part_number_seq          BIGINT      NOT NULL,

  -- 必填外鍵
  manufacturing_method_id  INT    NOT NULL REFERENCES manufacturing_methods(id) ON DELETE RESTRICT,
  system_id                INT    NOT NULL REFERENCES systems(id)               ON DELETE RESTRICT,
  designer_id              BIGINT NOT NULL REFERENCES users(id)                 ON DELETE RESTRICT, -- 指派者
  machinist_id             BIGINT NOT NULL REFERENCES users(id)                 ON DELETE RESTRICT, -- 被指派者

  -- 必填數值
  quantity                 INT NOT NULL CHECK (quantity > 0),

  -- 完成此任務可獲得的積分
  reward_points            INT NOT NULL DEFAULT 0 CHECK (reward_points >= 0),

  -- 選填
  drawing_url              TEXT,           -- CAD / Google Drive / Notion 連結
  dimension                VARCHAR(255),   -- 零件尺寸（自由文字，如 "100x50x10 mm"）
  material_id              INT REFERENCES materials(id) ON DELETE SET NULL,

  -- 狀態
  status_code              VARCHAR(30) NOT NULL DEFAULT 'pending'
                             REFERENCES task_statuses(code) ON DELETE RESTRICT,

  note                     TEXT,
  due_date                 DATE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tasks_prefix_seq UNIQUE (part_number_prefix, part_number_seq)
);

CREATE INDEX idx_tasks_machinist  ON tasks(machinist_id);
CREATE INDEX idx_tasks_designer   ON tasks(designer_id);
CREATE INDEX idx_tasks_status     ON tasks(status_code);
CREATE INDEX idx_tasks_system     ON tasks(system_id);

CREATE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 任務 <-> 後處理（多對多，可多道工序並排序）
CREATE TABLE task_post_processes (
  task_id         BIGINT NOT NULL REFERENCES tasks(id)          ON DELETE CASCADE,
  post_process_id INT    NOT NULL REFERENCES post_processes(id) ON DELETE RESTRICT,
  sort_order      INT NOT NULL DEFAULT 0,       -- 後處理順序
  PRIMARY KEY (task_id, post_process_id)
);

-- =========================================================
-- 6. 狀態異動歷史（稽核）
-- =========================================================
CREATE TABLE task_status_history (
  id           BIGSERIAL PRIMARY KEY,
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status  VARCHAR(30) REFERENCES task_statuses(code),
  to_status    VARCHAR(30) NOT NULL REFERENCES task_statuses(code),
  changed_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note         TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_history_task ON task_status_history(task_id);

-- =========================================================
-- 7. 積分明細帳（每次加/減分的來源紀錄，可稽核）
-- =========================================================
CREATE TABLE user_points_ledger (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     BIGINT REFERENCES tasks(id) ON DELETE SET NULL, -- 來源任務（可為 NULL，例如人工調整）
  points      INT NOT NULL,                                   -- 正=加分、負=扣分
  reason      VARCHAR(100) NOT NULL,                          -- 'task_completed','manual_adjust'...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同一任務對同一使用者只允許記一次（避免重複發放）
  CONSTRAINT uq_points_task_user UNIQUE (task_id, user_id)
);
CREATE INDEX idx_points_ledger_user ON user_points_ledger(user_id);

-- 寫入明細後，自動同步 users.total_points（單一資料來源）
CREATE OR REPLACE FUNCTION apply_points_to_user()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET total_points = total_points + NEW.points WHERE id = NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET total_points = total_points - OLD.points WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_points_ledger_sync
  AFTER INSERT OR DELETE ON user_points_ledger
  FOR EACH ROW EXECUTE FUNCTION apply_points_to_user();

-- =========================================================
-- 8. 任務積分自動計算
--    規則：(基礎 5 分 + 有後處理 +2 分) x 需求數量
-- =========================================================
CREATE OR REPLACE FUNCTION calc_reward_points(p_task_id BIGINT, p_qty INT)
RETURNS INT AS $$
DECLARE
  v_base      INT := 5;   -- 基礎分
  v_post_bonus INT := 2;  -- 後處理加分
  v_has_post  BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM task_post_processes WHERE task_id = p_task_id
  ) INTO v_has_post;

  RETURN (v_base + CASE WHEN v_has_post THEN v_post_bonus ELSE 0 END) * p_qty;
END;
$$ LANGUAGE plpgsql;

-- 建立任務、或數量變動時：自動填 reward_points
CREATE OR REPLACE FUNCTION trg_set_reward_points()
RETURNS TRIGGER AS $$
BEGIN
  NEW.reward_points := calc_reward_points(NEW.id, NEW.quantity);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_reward
  BEFORE INSERT OR UPDATE OF quantity ON tasks
  FOR EACH ROW EXECUTE FUNCTION trg_set_reward_points();

-- 後處理新增/移除時：重算該任務 reward_points
CREATE OR REPLACE FUNCTION trg_recalc_reward_on_post()
RETURNS TRIGGER AS $$
DECLARE
  v_task BIGINT := COALESCE(NEW.task_id, OLD.task_id);
BEGIN
  UPDATE tasks
     SET reward_points = calc_reward_points(v_task, quantity)
   WHERE id = v_task;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tpp_reward
  AFTER INSERT OR DELETE ON task_post_processes
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_reward_on_post();

-- =========================================================
-- 9. 加工者間積分轉讓
-- =========================================================
CREATE TABLE point_transfers (
  id           BIGSERIAL PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  points       INT NOT NULL CHECK (points > 0),
  note         VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_not_self CHECK (from_user_id <> to_user_id)
);
CREATE INDEX idx_transfers_from ON point_transfers(from_user_id);
CREATE INDEX idx_transfers_to   ON point_transfers(to_user_id);

-- 轉讓積分（併發安全：鎖住轉出者、餘額不足直接報錯）
CREATE OR REPLACE FUNCTION transfer_points(
  p_from BIGINT, p_to BIGINT, p_points INT, p_note VARCHAR DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_balance  BIGINT;
  v_transfer BIGINT;
BEGIN
  IF p_points <= 0 THEN
    RAISE EXCEPTION '轉讓積分必須為正數';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION '不可轉給自己';
  END IF;

  -- 鎖住轉出者，避免併發超轉
  SELECT total_points INTO v_balance FROM users WHERE id = p_from FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION '轉出者不存在';
  END IF;
  IF v_balance < p_points THEN
    RAISE EXCEPTION '積分不足（餘額 %，欲轉 %）', v_balance, p_points;
  END IF;

  INSERT INTO point_transfers (from_user_id, to_user_id, points, note)
  VALUES (p_from, p_to, p_points, p_note)
  RETURNING id INTO v_transfer;

  -- 寫入雙方明細帳；trigger 會自動同步 users.total_points
  INSERT INTO user_points_ledger (user_id, task_id, points, reason) VALUES
    (p_from, NULL, -p_points, 'transfer_out'),
    (p_to,   NULL,  p_points, 'transfer_in');

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;
-- 用法：SELECT transfer_points(1, 2, 30, '協助完成 ARM-0001');
