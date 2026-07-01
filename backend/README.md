# 零件加工任務管理系統 — Backend API

Production-ready REST API：Node.js + Express + PostgreSQL + Prisma + JWT。

## 架構

```
backend/
├── prisma/
│   ├── schema.prisma        # 資料模型
│   └── seed.js              # 角色 / admin / 主檔種子
├── src/
│   ├── config/             # env 驗證、Prisma 單例
│   ├── constants/          # 角色、任務狀態機
│   ├── controllers/        # 薄控制層（HTTP <-> service）
│   ├── middleware/         # auth / rbac / validate / rateLimit / error
│   ├── routes/             # 路由 + 權限掛載
│   ├── services/           # 商業邏輯（交易、狀態機、積分）
│   ├── utils/              # ApiError, jwt, password, partNumber...
│   ├── validators/         # zod 輸入驗證
│   ├── app.js              # Express 組裝（helmet/cors/limit）
│   └── server.js           # 啟動 + 優雅關閉
├── render.yaml             # Render 一鍵部署
└── .env.example
```

## 本地啟動

```bash
cp .env.example .env         # 填入 DATABASE_URL 與兩把 JWT secret
npm install
npx prisma migrate dev --name init
npm run db:seed              # 建立角色 + 預設 admin + 主檔
npm run dev
```

預設 admin：`admin / Admin@12345`（登入後請立即改密碼）。

## 安全機制

| 面向 | 實作 |
|---|---|
| 密碼 | bcrypt（rounds 可設定，預設 12），DB 只存 hash |
| 認證 | JWT access(1h) + refresh(7d)；refresh 存 hash、可撤銷、輪替 |
| 授權 | RBAC middleware（admin/designer/processor）+ service 層擁有權判斷 |
| 輸入驗證 | zod 全欄位驗證，清洗後才進 service（防注入） |
| SQL injection | Prisma parameterized query，無字串拼接 |
| URL 注入 | drawingUrl 僅允許 http/https scheme |
| 暴力破解 | 登入/註冊 rate limit（IP+username，15 分鐘 10 次） |
| HTTP headers | helmet |
| CORS | 環境變數白名單 |
| 錯誤處理 | 集中式 middleware，統一格式，不外洩 DB 錯誤/stack |
| Token 失效 | 改密碼/停權時撤銷所有 refresh token |

## API

Base URL：`/api/v1`。回應統一格式：
`{ "success": true, "data": ... }` 或 `{ "success": false, "error": { "code", "message", "details?" } }`

### Auth
| Method | Path | 權限 | 說明 |
|---|---|---|---|
| POST | `/auth/register` | 公開 | 註冊（僅 designer/processor） |
| POST | `/auth/login` | 公開 | 登入，回 access+refresh |
| POST | `/auth/refresh` | 公開 | 以 refresh 換發新 token（輪替） |
| POST | `/auth/logout` | 公開 | 撤銷 refresh token |
| GET | `/auth/me` | 登入 | 目前使用者 |

### Users
| Method | Path | 權限 |
|---|---|---|
| GET | `/users` | admin |
| GET | `/users/:id` | 本人或 admin |
| PUT | `/users/:id` | 本人改密碼 / admin 改角色/停權 |
| DELETE | `/users/:id` | admin（軟刪＝停用） |

### Tasks
| Method | Path | 權限 |
|---|---|---|
| POST | `/tasks` | admin, designer |
| GET | `/tasks` | 登入（processor 只見自己被指派的） |
| GET | `/tasks/:id` | 登入（含擁有權檢查） |
| PUT | `/tasks/:id` | admin 或建立者 |
| PATCH | `/tasks/:id/status` | 依狀態機＋擁有權 |
| DELETE | `/tasks/:id` | admin 或建立者（completed 不可刪） |

### Points（積分）
| Method | Path | 權限 | 說明 |
|---|---|---|---|
| POST | `/points/transfer` | processor, admin | 轉讓積分給其他使用者 |
| GET | `/points/me/ledger` | 登入 | 我的積分明細（加/扣分紀錄） |
| GET | `/points/me/transfers` | 登入 | 我的轉讓紀錄（`?direction=sent\|received\|all`） |

轉讓以條件式原子扣款（`totalPoints >= points` 才扣），並發安全、餘額不足回
`400 INSUFFICIENT_POINTS`；雙方各寫一筆 `transfer_out` / `transfer_in` 明細。

### 任務狀態機

```
pending ──► accepted ──► processing ──► completed
   │            │            │
   └────────────┴────────────┴──► cancelled（建立者）
   │            │
   └────────────┴──► rejected（加工者）
```

- 加工者（assignee）：accepted / rejected / processing / completed
- 建立者（creator）：cancelled
- admin：全部
- 非法轉換回 `400 INVALID_STATUS_TRANSITION`；越權回 `403`

### 零件編號

`SYSTEM_CODE-0001`，於 transaction 內用 `task_number_sequences` 原子遞增產生，
搭配 `tasks.part_number` UNIQUE 作最後防線，並發安全、不重複。

### 積分

- 任務積分 = `(5 + 有後處理?2:0) × 數量`（建立/編輯時計算）
- 任務 `completed` 時發給加工者，`user_points_ledger` 唯一鍵防重複發放

## 範例

```bash
# 登入
curl -X POST localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@12345"}'

# 建立任務（帶 access token）
curl -X POST localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"systemId":1,"manufacturingMethodId":1,"quantity":10,"postProcessId":1}'

# 加工者完成任務
curl -X PATCH localhost:3000/api/v1/tasks/1/status \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed"}'
```
