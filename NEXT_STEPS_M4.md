# sidereal-parts 目前待辦清單

> 目標: 把 M3/M4 從已推上 GitHub 變成正式可用。
> 目前最新 commit: `5e9007a Add Onshape embedded import panel`

---

## 1. 等部署完成

### Render 後端

到 Render:

```txt
sidereal-parts-api → Events / Logs
```

確認最新 commit 已部署成功。

成功後測:

```txt
https://sidereal-parts-api.onrender.com/health
```

應回:

```json
{"status":"ok"}
```

### Cloudflare 前端

到 Cloudflare:

```txt
Workers & Pages → sidereal-parts → Deployments
```

確認最新部署成功。

正式網址:

```txt
https://sidereal-parts.pages.dev
```

---

## 2. 確認 Render 環境變數

Render → `sidereal-parts-api` → Environment。

必要基本變數:

```txt
NODE_ENV=production
DATABASE_URL=<Neon connection string>
JWT_ACCESS_SECRET=<32字以上亂碼>
JWT_REFRESH_SECRET=<32字以上亂碼>
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=7d
BCRYPT_ROUNDS=12
SEED_ADMIN_USER=admin
SEED_ADMIN_PASS=Admin@12345
CORS_ORIGINS=https://sidereal-parts.pages.dev,https://*.pages.dev,http://localhost:5173
```

Onshape 必要變數:

```txt
ONSHAPE_CLIENT_ID=<Onshape OAuth Client ID>
ONSHAPE_CLIENT_SECRET=<Onshape OAuth Client Secret>
ONSHAPE_REDIRECT_URI=https://sidereal-parts-api.onrender.com/api/v1/onshape/callback
FRONTEND_URL=https://sidereal-parts.pages.dev
```

可選:

```txt
ONSHAPE_TOKEN_KEY=<32字以上亂碼>
```

改完環境變數後要重新部署 Render。

---

## 3. 確認 Cloudflare 環境變數

Cloudflare Pages → `sidereal-parts` → Settings → Environment variables。

確認:

```txt
VITE_API_BASE=https://sidereal-parts-api.onrender.com/api/v1
```

如果有修改，記得重新部署 Cloudflare Pages。

---

## 4. 設定 Onshape OAuth App

到:

```txt
https://dev-portal.onshape.com
```

建立或打開 OAuth application。

Redirect URLs 必須包含:

```txt
https://sidereal-parts-api.onrender.com/api/v1/onshape/callback
http://localhost:3000/api/v1/onshape/callback
```

Permissions 只勾:

```txt
Application can read your documents
```

不要勾 write/delete。

---

## 5. 設定 Onshape 右側面板 Extension

在同一個 Onshape OAuth application 裡新增 Extension。

設定:

```txt
Location:
Element right panel
```

Action URL:

```txt
https://sidereal-parts.pages.dev/onshape-panel?did={$documentId}&wvm=w&wvmid={$workspaceId}&eid={$elementId}
```

設定完成後，把 app 分享給隊伍 Onshape team。

隊員重新整理 Onshape 文件後，右側面板應該會出現 sidereal-parts app。

---

## 6. 測試網站內 M3 匯入

使用正式前端:

```txt
https://sidereal-parts.pages.dev
```

登入:

```txt
RJ / mentorrj
```

測試流程:

1. 右上角按「連結 Onshape」。
2. 完成 Onshape 授權。
3. 回到網站後進入「匯入」。
4. 貼 Onshape assembly URL。
5. 選 system / method / material / post process。
6. 按「預覽 BOM」。
7. 確認自製件與 COTS 分流。
8. 按「匯入成任務」。
9. 回看板確認任務已出現在任務池。

---

## 7. 測試 Onshape 內嵌 M4 面板

在 Onshape 裡:

1. 打開一個 assembly。
2. 開啟右側 sidereal-parts 面板。
3. 如果要求登入，就用 `RJ / mentorrj` 登入。
4. 面板應顯示縮圖或匯入 UI。
5. 選 system / method / material / post process。
6. 按「預覽」。
7. 按「匯入」。
8. 回網站看板確認任務建立。

---

## 8. 常見錯誤排查

### 看不到 Onshape 面板

檢查:

- Extension Location 是否為 `Element right panel`
- Action URL 是否完全正確
- App 是否分享給隊伍/team
- Onshape 文件是否已重新整理

### 面板打開但空白

檢查 Cloudflare 部署是否包含:

```txt
frontend/public/_headers
```

以及 Cloudflare 是否已重新部署。

### Onshape 授權失敗

檢查:

- Render 的 `ONSHAPE_REDIRECT_URI`
- Onshape Developer Portal 的 Redirect URL
- 兩者必須一字不差

### BOM 預覽失敗

檢查:

- 使用者是否已連結 Onshape
- 使用者 Onshape 帳號是否有文件權限
- URL 是否是 assembly element URL，需包含 `/e/{elementId}`

### 匯入後沒有任務

可能原因:

- BOM 全部被判定為 COTS
- Onshape BOM 沒有 part id
- 選錯 assembly 或 element

---

## 9. 下一階段

M4 驗收後，下一個大項是:

```txt
M5：DXF / STL / STEP 檔案管線
```

目標:

- 任務詳情頁一鍵下載加工檔
- 雷切/CNC 2D 給 DXF
- 3D 列印給 STL
- CNC 3D 給 STEP

