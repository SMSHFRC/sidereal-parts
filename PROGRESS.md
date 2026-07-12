# 技術進度報告 — 零件加工任務管理系統

> 最後更新：2026-07-04
> 狀態：**後端已部署上線（Render + Neon）並驗證通過；前端已完成開發與本機端到端測試，尚未部署上雲。**

---

## 1. 專案概觀

| 項目 | 內容 |
|---|---|
| 系統目的 | 管理「設計者 → 加工者」的零件加工任務流程：建立任務、指派、狀態流轉、積分獎勵與轉讓 |
| 原始碼 | GitHub：`WindGreen0130/sidereal-parts`（branch `main`） |
| 後端 | `backend/` — Node.js REST API，**已上線** `https://sidereal-parts.onrender.com` |
| 前端 | `frontend/` — Vite + React SPA，**本機開發完成**，未部署 |
| 部署架構 | Render Web Service（API）+ Neon Serverless PostgreSQL（DB） |

```
瀏覽器(前端 SPA) ──HTTPS──► Render(Express API) ──SSL──► Neon(PostgreSQL 16)
```

---

## 2. 技術棧

### 後端（backend/）
| 類別 | 技術 | 版本 |
|---|---|---|
| Runtime | Node.js（ESM） | 開發環境 v24.18.0；`engines >=20` |
| Web | Express | ^4.21.2 |
| ORM | Prisma | ^5.22.0 |
| DB | PostgreSQL 16（本機）/ Neon（線上） | |
| 認證 | jsonwebtoken（JWT） | ^9.0.2 |
| 密碼 | **bcryptjs**（見 §11 決策） | ^2.4.3 |
| 驗證 | zod | ^3.23.8 |
| 安全 | helmet ^8、cors ^2.8.5、express-rate-limit ^7 | |
| 測試 | node:test + supertest ^7 | |

### 前端（frontend/）
| 類別 | 技術 | 版本 |
|---|---|---|
| Build | Vite | ^6.0.5 |
| UI | React 18 + TypeScript | ^18.3.1 / ~5.6.3 |
| CSS | Tailwind CSS v4（@tailwindcss/vite 插件，無 config 檔） | ^4.0.0 |
| 路由 | react-router-dom | ^6.28.0 |
| 狀態 | 無外部庫；fetch 包裝 + React Context（auth） | |

---

## 3. 專案結構

```
sidereal part/                     (repo 根)
├── render.yaml                    # Render Blueprint（Neon 版，rootDir: backend）
├── PROGRESS.md                    # 本文件
├── schema.sql / schema.prisma / seed.sql   # 早期獨立 SQL 設計（非線上真實來源，見 §11）
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # ★ 資料模型唯一真實來源
│   │   ├── migrations/20260701073252_init/
│   │   └── seed.js                # 角色 / admin / 主檔（upsert，可重跑）
│   ├── src/
│   │   ├── config/    env.js(啟動驗證環境變數) prisma.js(單例)
│   │   ├── constants/ roles.js  taskStatus.js(狀態機)
│   │   ├── controllers/ auth / user / task / points
│   │   ├── middleware/ auth(JWT) rbac validate(zod) rateLimit error(集中處理)
│   │   ├── routes/    auth / users / tasks / points + index
│   │   ├── services/  auth / user / task / points（交易、狀態機、積分）
│   │   ├── utils/     ApiError asyncHandler jwt password partNumber serialize
│   │   ├── validators/ zod schemas
│   │   ├── app.js     # helmet/cors/limit/路由/根路由/健康檢查
│   │   └── server.js  # 啟動 + 優雅關閉
│   └── tests/e2e.test.js          # 16 案例整合測試
└── frontend/
    ├── src/
    │   ├── api.ts       # 型別(依實測JSON) + fetch包裝 + 401自動刷新 + 狀態機 + 主檔選項
    │   ├── auth.tsx     # AuthContext
    │   ├── ui.tsx       # StatusBadge/Spinner/ErrorBox/Field
    │   ├── App.tsx      # WakeGate(冷啟動畫面) + 路由守衛 + Layout
    │   └── pages/       # Login / Board / TaskDetail / NewTask
    ├── .env.example     # VITE_API_BASE
    └── README.md
```

---

## 4. 資料模型（backend/prisma/schema.prisma）

資料表：`roles` `users` `refresh_tokens` `systems` `manufacturing_methods` `materials` `post_processes` `task_number_sequences` `tasks` `task_status_history` `user_points_ledger` `point_transfers`

關聯重點：
- `users → roles` 多對一（單一 `role_id`）
- `tasks → users` 兩條具名外鍵：`creator_id`（設計者）、`assignee_id`（加工者，可 NULL）
- `tasks → systems/methods/materials?/post_processes?` 多對一
- `task_status_history` 稽核每次狀態變更
- `user_points_ledger` 積分明細帳（`UNIQUE(task_id,user_id)` 防重複發放）
- `refresh_tokens` 只存 SHA-256 hash，可撤銷/輪替
- BigInt 主鍵 → **JSON 序列化為字串**（前端型別依此）

狀態 enum：`pending / accepted / processing / completed / rejected / cancelled`

---

## 5. 核心商業邏輯

### 零件編號（並發安全）
- 格式 `SYSTEM_CODE-####`（如 `ARM-0001`），prefix = systems.code
- 交易內 `task_number_sequences` upsert + atomic increment，`part_number` UNIQUE 雙保險
- 實測 10 筆並發零重複

### 任務狀態機
```
pending ──► accepted ──► processing ──► completed(終)
   │            │             │
   │            └─► rejected(終)     ←由 assignee
   └────────────┴─────────────┴─► cancelled(終)  ←由 creator
```
- 觸發者：assignee = accepted/rejected/processing/completed；creator = cancelled；admin 全放行
- 未指派任務不可 accept（400 `任務尚未指派加工者`）
- 非法轉換 400 `INVALID_STATUS_TRANSITION`；越權 403
- 前端與後端狀態機**同一份規則**（frontend/src/api.ts 的 TRANSITIONS/ACTOR 對齊 backend/src/constants/taskStatus.js），非法按鈕不渲染

### 積分
- 任務積分 = `(5 + 有後處理?2:0) × 數量`，建立/編輯時計算存 `reward_points`
- `completed` 時發給 assignee（交易內：ledger + totalPoints increment）
- 轉讓 `POST /points/transfer`：條件式原子扣款（`WHERE totalPoints >= points`）防超轉

---

## 6. API 端點（Base `/api/v1`）

回應格式：`{success:true,data}` / `{success:false,error:{code,message,details?}}`

| Method | Path | 權限 |
|---|---|---|
| GET | `/`、`/health` | 公開（服務資訊/探針） |
| POST | `/auth/register` | 公開（限 designer/processor） |
| POST | `/auth/login` `/auth/refresh` `/auth/logout` | 公開 |
| GET | `/auth/me` | 登入 |
| GET | `/users` | admin |
| GET/PUT | `/users/:id` | 本人或 admin（角色/停權僅 admin） |
| DELETE | `/users/:id` | admin（軟刪＝停用） |
| POST | `/tasks` | admin, designer |
| GET | `/tasks` | 登入（**processor 只見指派給自己的**） |
| GET | `/tasks/:id` | 登入 + 擁有權檢查 |
| PUT | `/tasks/:id` | admin 或 creator（可改 assigneeId；終態鎖定） |
| PATCH | `/tasks/:id/status` | 狀態機 + 擁有權 |
| DELETE | `/tasks/:id` | admin 或 creator（completed 不可刪） |
| POST | `/points/transfer` | processor, admin |
| GET | `/points/me/ledger` `/points/me/transfers` | 登入 |

---

## 7. 安全機制

| 面向 | 實作 |
|---|---|
| 密碼 | bcryptjs（rounds 12），只存 hash |
| JWT | access 1h + refresh 7d；refresh 存 hash、輪替、可撤銷；改密碼/停權時全撤銷 |
| RBAC | middleware 角色檢查 + service 層擁有權判斷 |
| 輸入 | zod 全欄位驗證清洗；drawingUrl 僅 http/https |
| SQLi | Prisma parameterized，零字串拼接 |
| 暴力破解 | 登入/註冊 15 分鐘 10 次（IP+username） |
| Headers/CORS | helmet + 環境變數白名單 |
| 錯誤 | 集中 middleware；Prisma 錯誤映射安全訊息；prod 不洩 stack |
| 前端 token | localStorage；401 單一航班 silent refresh 一次，失敗導回 /login |

---

## 8. 測試與驗證

### 後端整合測試（本機 PostgreSQL）
`backend/tests/e2e.test.js` — **16/16 通過**，可重複執行：
註冊/登入、弱密碼擋、建任務+編號+積分、編號遞增、10 筆並發零重複、RBAC 403、401、非法狀態轉換、非擁有者 403、accepted→processing→completed、完成發 70 分、轉讓 30 分餘額 40/30、餘額不足、不可轉自己、completed 不可刪、processor 清單隔離。

### 前端（真實瀏覽器，Claude Preview 面板 + 本機後端）
- `npm run build`：TS 零錯誤；bundle gzip ~60KB
- 登入 → 看板渲染（欄位計數、卡片、monospace 編號、徽章）✅
- 詳情頁 10 欄位、繪圖外連、admin 動作按鈕 ✅
- 錯誤路徑：未指派任務按接受 → 紅框顯示「任務尚未指派加工者」✅
- 成功路徑：取消任務 → 徽章「已取消」、按鈕消失 ✅
- 新增表單四組下拉選項 ✅

### 線上（production）驗證
- `GET /health` 200 ✅
- admin 登入取得 JWT ✅；`GET /auth/me` 授權通過 ✅
- designer01 建任務 ARM-0001 ✅ → API 指派 processor01 後其看板可見 ✅

---

## 9. 部署（線上環境）

### Render Web Service
| 設定 | 值 |
|---|---|
| URL | `https://sidereal-parts.onrender.com` |
| Root Directory | `backend` |
| Build | `npm ci && npx prisma generate && npx prisma migrate deploy && npm run db:seed` |
| Start | `npm start`；Health check `/health` |
| Plan | Free（15 分鐘閒置休眠，冷啟動 30–60 秒） |

環境變數：`NODE_ENV` `DATABASE_URL`(Neon direct + `sslmode=require`) `JWT_ACCESS_SECRET` `JWT_REFRESH_SECRET` `JWT_ACCESS_TTL=1h` `JWT_REFRESH_TTL=7d` `BCRYPT_ROUNDS=12` `SEED_ADMIN_USER=windgreen` `SEED_ADMIN_PASS`(僅 Render 保存) `CORS_ORIGINS`(待前端部署後填)

### Neon
- Serverless PostgreSQL 16，免費不過期，閒置 auto-suspend（喚醒 1–2 秒）
- 使用 **direct** 連線字串（非 pooled；migration 穩定）

### render.yaml（repo 根目錄）
Blueprint 版本：僅 Web Service、`rootDir: backend`、機敏值 `sync:false`、JWT secret 自動生成。

### 線上帳號
| 帳號 | 角色 | 密碼 |
|---|---|---|
| `windgreen` (id=1) | admin | Render 的 `SEED_ADMIN_PASS` |
| `designer01` (id=2) | designer | `Sidereal@2026a`（建議更換） |
| `processor01` (id=3) | processor | `Sidereal@2026b`（建議更換） |

線上任務：ARM-0001（pending，assignee=processor01，測試用）。

---

## 10. 前端細節

- **頁面**：`/login`、`/`（看板：手機 chips 切換 / 桌面三欄）、`/tasks/:id`（詳情+合法動作按鈕）、`/tasks/new`（designer/admin 限定）
- **WakeGate**：進站先打 `/health`，顯示「伺服器喚醒中…」全螢幕 + 重試（90s timeout）
- **zh-TW / Asia/Taipei**；觸控目標 ≥44px；行動優先
- **型別來源**：實測本機後端 JSON（非猜測）——任務無 `name` 欄位（用 `note`）、積分為 `rewardPoints`、id 皆字串
- **主檔選項硬編**於 `api.ts`（後端無列表端點且 POST 需數字 ID；對應 seed 資料，主檔異動需同步）
- 本機開發捷徑：`C:\dev\sidereal-frontend`（junction → 實際資料夾，繞開路徑空格問題）；啟動 `npm run dev` → `http://localhost:5173`

---

## 11. 關鍵技術決策

| 決策 | 原因 |
|---|---|
| bcrypt → **bcryptjs** | 本機 npm 擋原生 install script；純 JS drop-in。可在能編譯的環境改回 |
| 單一 `role_id`、單一 `post_process_id`、status 用 enum | 依後端需求規格 section 4；早期 `schema.sql`(repo 根) 的多對多/查表設計**未沿用**，`backend/prisma/schema.prisma` 為唯一真實來源 |
| Neon 而非 Render Postgres | 免費不過期、SSL、branch 功能 |
| render.yaml 移至 repo 根 | Blueprint 只偵測根目錄；加 `rootDir: backend` |
| 前端狀態機鏡射後端 | 非法按鈕不渲染；後端仍是最終防線 |
| 主檔選項前端硬編 | 後端無查詢端點（見 §13 待辦） |

---

## 12. 開發環境備忘（Windows）

- Node/PostgreSQL/gh 均 winget 安裝，**不在 PATH**：`$env:PATH = "C:\Program Files\nodejs;" + $env:PATH`
- PostgreSQL 16：服務 `postgresql-x64-16`，port 5432，`postgres/postgres`，本機庫 `parts_task`
- 本機 npm 擋 install scripts（allow-scripts 包裝）→ 原生模組裝不了；Prisma 用 `npx prisma generate` 不受影響
- **路徑空格雷**：`sidereal part` 有空格 → npm.cmd 長路徑炸、8.3 短路徑讓 Node 24 fs-watcher assert 崩潰 → 解法：junction `C:\dev\sidereal-frontend`
- 本機 admin：`admin / Admin@12345`（僅本機 DB）
- PowerShell 5.1 打 API：避免反引號續行、body 存檔用 `--data "@file.json"`、TLS 1.2

---

## 13. 已知限制與待辦

### 已知限制
1. **前端無「指派加工者」欄位** → 新任務未指派，processor 看不到也不能接。原因：`GET /users` 僅 admin，designer 查不到加工者清單。目前 workaround：creator/admin 用 `PUT /tasks/:id` 帶 `assigneeId`（2026-07-04 已用此法指派 ARM-0001）
2. 前端無註冊頁（API 有 `/auth/register`，帳號需用 API 建）
3. 前端無積分轉讓 UI（API 完成）
4. Render Free 冷啟動 30–60 秒（已有 WakeGate 緩解）
5. 主檔選項前端硬編，主檔異動需改 `api.ts`

### 待辦
- [ ] **合併 PR #1**（https://github.com/WindGreen0130/sidereal-parts/pull/1 — root route + Neon 版 render.yaml；merge 後線上 `/` 才生效）
- [ ] **前端 commit + push**（`frontend/` 尚未進版控）
- [ ] **指派功能**：後端加「加工者清單」端點 + 前端表單加指派下拉（解除限制 1）
- [ ] **前端部署**（Vercel/Netlify）+ Render `CORS_ORIGINS` 填前端網域 → 成為完整可公開網站
- [ ] 完成線上端到端測試腳本 ④⑤（processor01 接單→完成→積分 14 分）
- [ ] 更換 demo 帳號密碼；確認 admin 密碼強度
- [ ] （選）註冊頁、積分轉讓 UI、任務編輯 UI、主檔管理 UI
- [ ] （選）正式營運升級付費方案（免休眠）
