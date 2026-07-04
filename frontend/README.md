# 零件加工任務系統 — 前端

行動優先的最小前端（Vite + React 18 + TypeScript + Tailwind CSS v4），
對接已部署的後端 API，不含任何後端修改。

## 啟動

```bash
cp .env.example .env   # 需要時修改 VITE_API_BASE
npm install
npm run dev            # http://localhost:5173
```

正式打包：`npm run build`（輸出至 `dist/`，可部署到 Vercel / Netlify / Render Static）。

## 環境變數

| 變數 | 說明 | 預設 |
|---|---|---|
| `VITE_API_BASE` | 後端 API base（含 `/api/v1`） | `https://sidereal-parts.onrender.com/api/v1` |

## 頁面

| 路徑 | 說明 |
|---|---|
| `/login` | 登入 |
| `/` | 任務看板（手機：狀態 chips 切換；桌面：三欄） |
| `/tasks/:id` | 任務詳情 + 依角色/狀態顯示合法操作按鈕 |
| `/tasks/new` | 新增任務（designer / admin 限定） |

## 設計備註

- **Token**：access/refresh 存 localStorage；401 時自動以 refresh 換發一次（單一航班），失敗則導回登入。
- **冷啟動**：首次進站先打 `/health`，顯示「伺服器喚醒中…」全螢幕狀態（Render free tier 約 30–60 秒）。
- **狀態機**：與後端 `constants/taskStatus.js` 對齊，非法操作按鈕直接不渲染。
- **主檔選項**：後端未提供 systems/methods/materials/postProcesses 列表端點，
  而 `POST /tasks` 需要數字 ID，故選項硬編於 `src/api.ts`（對應 seed 資料）。
  若後端主檔異動需同步更新。
- 任務沒有 `name` 欄位（依實測 API），卡片標題使用 `partNumber`、說明使用 `note`。
