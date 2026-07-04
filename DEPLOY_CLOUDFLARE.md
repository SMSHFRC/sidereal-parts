# Cloudflare Pages 部署指南

本指南用於把 `sidereal-parts` 前端部署到 Cloudflare Pages，並讓它連到 Render 上的後端 API。

## 目前 GitHub 分支

已推上 GitHub 的分支：

```text
deploy/render-neon-config
```

目前包含：

- 後端 M1：`member/admin` 角色、自認領接單、任務池、`GET /meta/options`
- 前端 React SPA：看板、任務詳情、新增任務、登入
- Cloudflare SPA fallback：`frontend/public/_redirects`
- 後端 CORS wildcard 支援：可允許 `https://*.pages.dev`

## 1. 建立 Cloudflare Pages 專案

1. 進入 Cloudflare Dashboard
2. 選 `Workers & Pages`
3. 點 `Create application`
4. 選 `Pages`
5. 選 `Connect to Git`
6. 選 GitHub repo：

```text
WindGreen0130/sidereal-parts
```

7. 選部署分支：

```text
deploy/render-neon-config
```

## 2. Cloudflare Pages Build 設定

填入以下設定：

```text
Framework preset: None / Vite
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

如果 Cloudflare UI 顯示 `Build system version`，用預設即可。

## 3. Cloudflare Pages 環境變數

在 Pages 專案設定中加入：

```text
VITE_API_BASE=https://sidereal-parts.onrender.com/api/v1
```

注意：必須包含 `/api/v1`。

## 4. 部署前端

按 `Save and Deploy`。

部署完成後會得到類似：

```text
https://sidereal-parts.pages.dev
```

或 preview 網址：

```text
https://<hash>.sidereal-parts.pages.dev
```

先複製實際 Cloudflare Pages 網址，下一步要填到 Render。

## 5. Render 後端 CORS 設定

進入 Render：

```text
https://dashboard.render.com
```

找到後端服務 `sidereal-parts`，進入 `Environment`，設定：

```text
CORS_ORIGINS=https://你的-pages正式網址.pages.dev,https://*.pages.dev,http://localhost:5173
```

範例：

```text
CORS_ORIGINS=https://sidereal-parts.pages.dev,https://*.pages.dev,http://localhost:5173
```

存檔後，Render 會自動 redeploy。若沒有自動部署，手動點：

```text
Manual Deploy -> Deploy latest commit
```

## 6. 確認 Render 部署分支

如果 Render 目前不是部署 `deploy/render-neon-config`，要二選一：

### 選項 A：Render 改部署這個分支

Render service 設定中把 branch 改成：

```text
deploy/render-neon-config
```

### 選項 B：把分支合併回 main

之後再讓 Render 照原本 `main` 部署。

## 7. 驗收流程

部署完成後，開 Cloudflare Pages 網址。

### 1. 登入

使用線上資料庫裡已存在的帳號登入。

如果還沒建立 member 帳號，先用 admin 或 API 建帳號。

### 2. 建任務

1. 點 `新增`
2. 選系統、加工方式、數量
3. 不指定加工者
4. 建立後任務應進入 `任務池`

### 3. 接單

1. 到看板 `任務池`
2. 按 `接單`
3. 任務狀態應變成 `已接受`

### 4. 完成

依序操作：

```text
接單 -> 開始加工 -> 完成
```

若有後處理，流程是：

```text
接單 -> 開始加工 -> 加工完成，交後處理 -> 接下後處理 -> 完成
```

### 5. 檢查積分

完成後，右上角積分應增加。

## 8. 常見問題

### 頁面打開空白或 404

確認 Cloudflare build output directory 是：

```text
dist
```

確認 repo 有：

```text
frontend/public/_redirects
```

內容應為：

```text
/* /index.html 200
```

### 登入或 API 失敗

檢查 Cloudflare Pages 環境變數：

```text
VITE_API_BASE=https://sidereal-parts.onrender.com/api/v1
```

改完後要重新部署前端。

### 瀏覽器 Console 出現 CORS

檢查 Render 的：

```text
CORS_ORIGINS
```

至少包含：

```text
https://你的-pages網址.pages.dev
```

建議同時包含：

```text
https://*.pages.dev
```

### 按接單顯示「找不到此路由」

代表 Render 後端還沒部署到包含 `POST /tasks/:id/claim` 的版本。

請確認 Render 部署分支含有 commit：

```text
33dbc16 Implement M1 member task flow and frontend
f53864c Support Cloudflare Pages CORS origins
```

然後重新 deploy backend。

## 9. 本機指令備忘

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

本機前端網址：

```text
http://localhost:5173
```
