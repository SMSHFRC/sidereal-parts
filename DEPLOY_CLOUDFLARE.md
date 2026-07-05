# Cloudflare Pages 部署指南

這份文件用來把 `sidereal-parts` 前端部署到 Cloudflare Pages，並連到 Render 上的後端 API。

## 0. 快速設定表

### GitHub

| 項目 | 值 |
|---|---|
| Repo | `SMSHFRC/sidereal-parts` |
| Repo URL | `https://github.com/SMSHFRC/sidereal-parts.git` |
| 部署分支 | `main` |

### Cloudflare Pages

| 欄位 | 值 |
|---|---|
| Framework preset | `Vite` 或 `None` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `VITE_API_BASE=https://sidereal-parts-api.onrender.com/api/v1` |

### Render Backend

| 欄位 | 值 |
|---|---|
| Backend URL | `https://sidereal-parts-api.onrender.com` |
| API base | `https://sidereal-parts-api.onrender.com/api/v1` |
| CORS_ORIGINS 範例 | `https://你的-pages網址.pages.dev,https://*.pages.dev,http://localhost:5173` |

## 1. 部署前確認

目前 repo 已包含：

- 後端 M1：`member/admin` 角色、任務池、自認領接單、`GET /meta/options`
- 前端 React SPA：登入、看板、任務詳情、新增任務
- Cloudflare Pages SPA fallback：`frontend/public/_redirects`
- 後端 CORS wildcard 支援：可允許 `https://*.pages.dev`

確認 GitHub repo：

```text
https://github.com/SMSHFRC/sidereal-parts
```

確認分支：

```text
main
```

## 2. 建立 Cloudflare Pages 專案

1. 進入 Cloudflare Dashboard
2. 打開 `Workers & Pages`
3. 點 `Create application`
4. 選 `Pages`
5. 選 `Connect to Git`
6. 授權並選擇 repo：

```text
SMSHFRC/sidereal-parts
```

7. 選 branch：

```text
main
```

## 3. 設定 Build

在 Cloudflare Pages 的 build 設定填：

```text
Framework preset: Vite
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

如果 `Framework preset` 沒有選 Vite，也可以選 `None`，只要其他欄位正確即可。

## 4. 設定前端環境變數

在 Cloudflare Pages 的 `Environment variables` 加入：

```text
VITE_API_BASE=https://sidereal-parts-api.onrender.com/api/v1
```

注意：

- 必須包含 `/api/v1`
- 改環境變數後，要重新部署 Cloudflare Pages

## 5. 部署前端

按：

```text
Save and Deploy
```

部署完成後，Cloudflare 會產生網址，例如：

```text
https://sidereal-parts.pages.dev
```

或 preview 網址：

```text
https://<hash>.sidereal-parts.pages.dev
```

複製實際可開啟的 Pages 網址，下一步要填到 Render。

## 5.5 綁自訂網域 part.team9501.org

因為 `team9501.org` 已在同一個 Cloudflare 帳號，綁子網域最順（DNS 自動建）：

1. Pages 專案 → **Custom domains** → **Set up a custom domain**
2. 輸入 `part.team9501.org` → **Continue**
3. Cloudflare 自動建 CNAME（`part` → `專案.pages.dev`）並簽 SSL → **Activate domain**
4. 等狀態變 **Active**（同帳號通常 1–2 分鐘）

正式對外網址即 `https://part.team9501.org`。

## 6. 設定 Render CORS

進入 Render Dashboard：

```text
https://dashboard.render.com
```

找到後端服務 `sidereal-parts`，打開：

```text
Environment
```

設定或更新：

```text
CORS_ORIGINS=https://你的-pages網址.pages.dev,https://*.pages.dev,http://localhost:5173
```

正式（含 team9501.org 自訂網域）：

```text
CORS_ORIGINS=https://part.team9501.org,https://*.pages.dev,http://localhost:5173
```

同時（若已設定 Onshape）更新 `FRONTEND_URL=https://part.team9501.org`，
讓 Onshape 授權完成後導回正式網址。

存檔後讓 Render 重新部署。若沒有自動部署，點：

```text
Manual Deploy -> Deploy latest commit
```

## 7. 確認 Render 後端版本

Render 後端必須部署到包含 M1 的版本，至少要有以下 commit：

```text
33dbc16 Implement M1 member task flow and frontend
f53864c Support Cloudflare Pages CORS origins
b730e56 Add Cloudflare deployment guide
```

如果 Render 還連到舊的 GitHub repo 或舊 branch，請改成部署：

```text
SMSHFRC/sidereal-parts
branch: main
```

## 8. 驗收流程

部署完成後，打開 Cloudflare Pages 網址。

### 8.1 登入

用線上資料庫已有帳號登入。

如果還沒有 member 帳號，先用 admin 或 API 建立 member。

### 8.2 建立任務

1. 點 `新增`
2. 選系統
3. 選加工方式
4. 填數量
5. 不指定加工者
6. 建立任務

預期結果：任務會進入 `任務池`。

### 8.3 接單

1. 回到看板
2. 切到 `任務池`
3. 按 `接單`

預期結果：任務狀態變成 `已接受`，加工者變成目前登入的 member。

### 8.4 完成任務

無後處理任務：

```text
接單 -> 開始加工 -> 完成
```

有後處理任務：

```text
接單 -> 開始加工 -> 加工完成，交後處理 -> 接下後處理 -> 完成
```

預期結果：完成後右上角積分增加。

## 9. 常見問題

### 頁面重新整理後 404

確認 repo 有此檔：

```text
frontend/public/_redirects
```

內容必須是：

```text
/* /index.html 200
```

確認 Cloudflare build output directory 是：

```text
dist
```

### 登入失敗或 API 沒反應

檢查 Cloudflare Pages 環境變數：

```text
VITE_API_BASE=https://sidereal-parts-api.onrender.com/api/v1
```

如果少了 `/api/v1`，前端會打錯 API。

### 瀏覽器 Console 出現 CORS 錯誤

檢查 Render 的 `CORS_ORIGINS`。

至少要包含你的 Pages 網址：

```text
https://你的-pages網址.pages.dev
```

建議同時包含 preview wildcard：

```text
https://*.pages.dev
```

### 按「接單」顯示「找不到此路由」

新前端已改成相容舊後端的接單方式，會呼叫：

```text
PATCH /tasks/:id/status
```

如果仍然看到「找不到此路由」，通常代表 Cloudflare 還在跑舊版前端。

處理方式：

1. 確認 GitHub `SMSHFRC/sidereal-parts` 已有最新 commit
2. 到 Cloudflare Pages 重新部署最新版
3. 部署完成後按 `Ctrl + F5` 重新整理頁面

如果錯誤變成「無權執行此狀態變更」，代表線上後端仍是舊角色規則，請用 `processor01` 帳號測接單，或之後再更新後端。

### Cloudflare build 失敗

先確認 build 設定：

```text
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

如果 Root directory 沒填 `frontend`，Cloudflare 會在 repo root 找不到前端 package。

## 10. 本機指令備忘

後端測試：

```powershell
cd backend
npm test
```

前端 build：

```powershell
cd frontend
npm run build
```

前端本機預覽：

```powershell
cd frontend
npm run dev
```

本機網址：

```text
http://localhost:5173
```

後端 health check：

```text
https://sidereal-parts-api.onrender.com/health
```
