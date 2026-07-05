# Onshape 整合設定指南（M3）

> 目的：讓每位隊員用自己的 Onshape 帳號授權本系統，任務即可顯示零件縮圖、
> 自動帶入零件資料、整批匯入 BOM。
> 完成本指南約需 **10 分鐘**，只需做一次。

---

## 整體流程長什麼樣

```
隊員按「連結 Onshape」──► 跳轉 Onshape 授權頁 ──► 同意
        ▲                                          │
        │                                          ▼
   前端(Pages)  ◄── 導回 ◄── 後端 callback 收 code、換 token（加密存 DB）

之後所有 Onshape 請求（縮圖 / 零件 / BOM）都由後端代理，
前端與瀏覽器永遠碰不到 token。
```

---

## Step 1：註冊 OAuth App（管理者做一次）

1. 用**隊伍的 Onshape 帳號**登入 https://dev-portal.onshape.com
2. 左側 **OAuth applications** → **Create new OAuth application**
3. 依下表填寫：

| 欄位 | 填什麼 |
|---|---|
| **Name** | `sidereal-parts`（顯示在授權頁，隊員看得到） |
| **Primary format** | `com.smshfrc.sidereal-parts`（全域唯一識別，反網域格式） |
| **Summary** | 隨意，例：FRC 零件加工任務管理系統 |
| **Redirect URLs** | 見下方，**兩條都要加** |
| **Admin team** | 留預設 |
| **OAuth URL** | 留空 |

**Redirect URLs（一字不差）：**

```
http://localhost:3000/api/v1/onshape/callback
https://sidereal-parts-api.onrender.com/api/v1/onshape/callback
```

4. **Permissions（權限）**：只勾
   - ✅ **Application can read your documents**（OAuth2Read）

   ❌ 不要勾 write / delete —— 本系統只讀取，最小權限原則。

5. 按 **Create application**。

### ⚠️ 立刻保存 Secret

建立成功後會顯示：

| 名稱 | 長相 | 注意 |
|---|---|---|
| **Client ID** | `XXXXXXXX...` 一串英數 | 之後隨時查得到 |
| **Client Secret** | 另一串英數 | **只顯示這一次**，關掉就再也看不到，馬上複製存好 |

> Secret 弄丟了怎麼辦：進該 app 頁面重新產生一組（舊的會失效）。

---

## Step 2：填環境變數

### 本機開發（`backend/.env`）

```env
ONSHAPE_CLIENT_ID=貼你的ClientID
ONSHAPE_CLIENT_SECRET=貼你的ClientSecret
ONSHAPE_REDIRECT_URI=http://localhost:3000/api/v1/onshape/callback
FRONTEND_URL=http://localhost:5173
```

### 正式環境（Render Dashboard → sidereal-parts-api → Environment）

| Key | Value |
|---|---|
| `ONSHAPE_CLIENT_ID` | 同一組 Client ID |
| `ONSHAPE_CLIENT_SECRET` | 同一組 Client Secret |
| `ONSHAPE_REDIRECT_URI` | `https://sidereal-parts-api.onrender.com/api/v1/onshape/callback` |
| `FRONTEND_URL` | `https://sidereal-parts.pages.dev` |

存檔後 Render 會自動重新部署。

> 🔒 **Secret 絕不放進 GitHub**。只存在 `.env`（已被 gitignore）和 Render 環境變數。

---

## Step 3：每位隊員連結自己的帳號

1. 登入系統 → 按「**連結 Onshape**」（前端 P2 上線後出現；目前可用 API：`GET /api/v1/onshape/auth-url` 取得跳轉網址）
2. 跳轉到 Onshape 授權頁 → 檢查權限只有「讀取文件」→ **Authorize**
3. 自動導回系統，顯示「已連結」

之後這位隊員看任務時就能載入縮圖、建任務時能選零件。

> 隊員需要**有權存取隊伍 Onshape 文件的帳號**（教育版即可）。
> 系統只能讀到「該隊員本來就看得到」的文件——權限跟著人走。

---

## 功能對照（哪個端點做什麼）

| 功能 | 端點 | 階段 |
|---|---|---|
| 查詢是否已連結 | `GET /api/v1/onshape/status` | P1 ✅ |
| 取得授權跳轉網址 | `GET /api/v1/onshape/auth-url` | P1 ✅ |
| 解除連結 | `DELETE /api/v1/onshape/connection` | P1 ✅ |
| 貼連結 → 驗證＋文件名稱 | `POST /api/v1/onshape/resolve` `{url}` | P1 ✅ |
| 零件縮圖（img 直接指這裡） | `GET /api/v1/onshape/thumbnail?did=&wvm=&wvmId=&eid=` | P1 ✅ |
| Part Studio 零件清單 | `GET /api/v1/onshape/parts?did=&wvm=&wvmId=&eid=` | P1 ✅ |
| Assembly BOM | `GET /api/v1/onshape/bom?did=&wvm=&wvmId=&eid=` | P1 ✅ |
| 任務頁縮圖＋預覽卡 UI | — | P2 |
| 建任務零件選擇器（自動帶入名稱/材料） | — | P3 |
| BOM 整批建任務 UI | — | P4 |

另外：任務的 `drawingUrl` 只要是 Onshape 連結，後端會**自動解析**存下文件參照，舊任務貼過的連結 P2 上線後縮圖直接生效。

---

## 快速驗證（設定完 5 分鐘測試）

```powershell
# 1. 登入拿 token（換成你的帳密）
$login = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/auth/login" -ContentType "application/json" -Body '{"username":"admin","password":"Admin@12345"}'
$tok = $login.data.accessToken

# 2. 確認 Onshape 功能已啟用
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/onshape/status" -Headers @{Authorization="Bearer $tok"}
# 期望：enabled=True, connected=False

# 3. 取授權網址 → 貼到瀏覽器完成授權
(Invoke-RestMethod -Uri "http://localhost:3000/api/v1/onshape/auth-url" -Headers @{Authorization="Bearer $tok"}).data.url

# 4. 授權完成後再查一次，connected 應為 True
# 5. 貼一條你們的 Onshape 文件連結試解析
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/onshape/resolve" -Headers @{Authorization="Bearer $tok"} -ContentType "application/json" -Body '{"url":"你的Onshape文件連結"}'
# 期望：回 documentName 與 ref
```

---

## 疑難排解

| 症狀 | 原因 / 解法 |
|---|---|
| `503 ONSHAPE_DISABLED` | 環境變數沒填或沒重啟後端；檢查 `ONSHAPE_CLIENT_ID/SECRET` |
| 授權後跳到 Onshape 錯誤頁 `redirect_uri mismatch` | dev portal 的 Redirect URL 與 `ONSHAPE_REDIRECT_URI` **不一致**（含 http/https、結尾斜線）|
| 導回前端網址錯 | `FRONTEND_URL` 沒設或設錯 |
| `428 ONSHAPE_NOT_CONNECTED` | 這位使用者還沒授權，或授權已被撤銷 → 重新走連結流程 |
| `403 無權存取此文件` | 該隊員的 Onshape 帳號本來就看不到這份文件 → 去 Onshape 分享給他 |
| `?onshape=error` 導回 | state 過期（授權頁放超過 10 分鐘）→ 重按連結 |
| 縮圖不顯示 | 確認 img src 走我們的 `/onshape/thumbnail` 代理，不能直接指 Onshape |

## 安全設計備忘

- Token **AES-256-GCM 加密**後才落資料庫；金鑰在環境變數，DB 外洩拿不到可用 token
- OAuth `state` 為 10 分鐘簽名 JWT，防 CSRF/替身授權
- 只申請**唯讀**權限；系統永遠無法改動或刪除 CAD 文件
- 每人 token 各自獨立，隊員離隊 → `DELETE /onshape/connection` 或停用帳號即斷
