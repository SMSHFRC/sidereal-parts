# sidereal-parts 使用者手冊

> 適用版本: M1 + M3 Onshape BOM 匯入版
> 使用對象: FRC 9501 隊員、Mentor、加工/設計協作者

---

## 1. 系統用途

sidereal-parts 是隊內零件加工任務系統。它的目標是把零件需求整理成任務池，讓隊員可以自行接單、回報進度、完成任務並累積積分。

目前已支援:

- 登入與登出
- 建立零件加工任務
- 任務池接單
- 任務狀態更新
- 後處理任務流程
- 積分入帳
- Onshape 帳號連結
- 建任務時貼 Onshape 連結，自動保存 Onshape 文件參照
- Onshape BOM 預覽與批次匯入
- 自製件自動建立/更新成任務
- COTS 零件自動分流並記錄
- 任務詳情頁顯示 Onshape 縮圖

目前尚未完成:

- DXF / STL / STEP 一鍵下載
- Revision stale 自動告警
- Discord Bot + AI Agent

---

## 2. 網址與帳號

正式前端網址:

```txt
https://sidereal-parts.pages.dev
```

正式後端健康檢查:

```txt
https://sidereal-parts-api.onrender.com/health
```

測試帳號範例:

```txt
RJ / mentorrj
```

管理員帳號:

```txt
admin / Admin@12345
```

> 管理員帳號只建議給維護者使用。一般隊員請使用 member 帳號。

---

## 3. 登入

1. 打開正式前端網址。
2. 輸入帳號與密碼。
3. 登入後會進入任務看板。

如果看到「伺服器喚醒中」，代表 Render 免費方案正在冷啟動。請等 30 到 60 秒。

---

## 4. 任務看板

看板分成幾個視角:

- 任務池: 尚未被接走的 pending 任務。
- 我接的: 目前由自己負責的任務。
- 我建的: 自己建立的任務。
- 全部: 所有任務。

任務卡會顯示:

- 零件編號，例如 `ARM-0001`
- 系統
- 加工方式
- 數量
- 狀態
- 可執行操作，例如接單

---

## 5. 建立任務

1. 點上方「新增」。
2. 選擇所屬系統。
3. 選擇加工方式。
4. 輸入數量。
5. 視需求填入材料、後處理、尺寸、備註。
6. 如果零件來自 Onshape，請把 Onshape 文件或 element 連結貼到「圖面連結」欄位。
7. 按「建立任務」。

建立後，任務會進入任務池，等待隊員接單。

### Onshape 連結格式

支援類似以下格式:

```txt
https://cad.onshape.com/documents/{documentId}/w/{workspaceId}/e/{elementId}
https://cad.onshape.com/documents/{documentId}/v/{versionId}/e/{elementId}
```

如果貼的是有效 Onshape 連結，系統會自動保存:

- document id
- workspace / version / microversion 類型
- workspace / version / microversion id
- element id

這些資料會用來顯示縮圖與後續 Onshape API 整合。

---

## 6. 接單

1. 到「任務池」。
2. 找到想做的任務。
3. 按「接單」。
4. 成功後任務會變成自己的任務。

注意:

- 同一個任務同時間只能被一個人接走。
- 如果兩個人同時按接單，只有一個人會成功，另一個人會看到任務已被接走。
- 可以接自己建立的任務。

---

## 7. 任務狀態

任務狀態流程:

```txt
pending -> accepted -> processing -> completed
```

如果有後處理:

```txt
pending -> accepted -> processing -> post_processing -> completed
```

常見操作:

- 接單: 從任務池認領任務。
- 開始加工: 將任務改為 processing。
- 交棒後處理: 有後處理時改為 post_processing。
- 完成: 任務完成並入帳積分。
- 放棄: 釋放任務回任務池。

---

## 8. 積分

目前積分規則:

- 加工: 每件 5 分
- 後處理: 每件 2 分

範例:

```txt
數量 10、有後處理:
加工者 50 分
後處理者 20 分
任務總積分 70 分
```

完成任務後，積分會自動入帳。

---

## 9. Onshape 帳號連結

如果系統已設定 Onshape OAuth，登入後右上角會看到 Onshape 連結按鈕。

### 連結步驟

1. 點「連結 Onshape」。
2. 進入 Onshape 授權頁。
3. 使用自己的 Onshape 帳號登入。
4. 按 Authorize。
5. 系統會自動回到任務網站。

連結成功後，右上角會顯示 Onshape 已連結狀態。

### 解除連結

1. 點右上角 Onshape 狀態按鈕。
2. 確認解除連結。
3. 系統會刪除你的 Onshape token。

解除連結後，任務仍存在，但你將無法查看需要 Onshape 授權的縮圖或資料。

---

## 10. Onshape 任務縮圖

如果任務的圖面連結是 Onshape element 連結，任務詳情頁會顯示 Onshape 區塊。

可能狀態:

- 已連結 Onshape: 顯示零件或 assembly 縮圖。
- 尚未連結 Onshape: 會提示先連結 Onshape。
- 沒有權限: 代表你的 Onshape 帳號沒有該文件權限。
- 縮圖載入失敗: 可能是 Onshape 暫時錯誤、連結格式不完整、或權限不足。

---

## 11. Onshape BOM 匯入

如果你有一個 Onshape assembly，可以用「匯入」功能把 BOM 批次轉成任務。

### 匯入步驟

1. 先確認自己已經連結 Onshape。
2. 點上方「匯入」。
3. 貼上 Onshape assembly URL。
4. 選擇系統。
5. 選擇加工方式。
6. 視需要選擇預設材料與後處理。
7. 按「預覽 BOM」。
8. 檢查自製件與 COTS 分流結果。
9. 確認後按「匯入成任務」。

匯入完成後，系統會顯示:

- 新增幾筆任務
- 更新幾筆既有任務
- 分流出幾筆 COTS
- 產生的任務編號

### 自製件與 COTS 分流

系統會用以下規則判斷 COTS:

- BOM row 來自不同 Onshape document。
- 零件料號看起來像供應商料號，例如 WCP、REV、AndyMark、VEX 等。
- BOM row 缺少可追蹤的 Onshape part id。

其餘項目會視為自製件，並建立成 pending 任務。

### 重複匯入

同一個 Onshape part 重複匯入時，系統會更新既有任務的:

- 數量
- 材料
- 後處理
- Onshape 版本/縮圖 metadata

但不會覆蓋:

- 任務狀態
- 已接單的加工者
- 已完成流程

這樣可以安全地重新整理 BOM，而不會把正在加工的任務洗掉。

---

## 12. 管理員功能

管理員可以:

- 查看使用者清單
- 停用使用者
- 修改使用者密碼
- 修改使用者角色
- 建任務時預先指派加工者或後處理者

一般隊員不需要使用管理員功能。

---

## 13. 常見問題

### 登入後一直卡在伺服器喚醒中

Render 免費方案可能正在冷啟動。等 30 到 60 秒後按重試。

### 接單後顯示任務已被接走

代表有人比你早接到同一筆任務。回到任務池刷新即可。

### 看不到 Onshape 縮圖

請確認:

1. 你已連結 Onshape。
2. 你有該 Onshape 文件的讀取權限。
3. 任務的圖面連結是 Onshape element 連結，最好包含 `/e/{elementId}`。

### 貼 Onshape 連結到新增任務後沒有自動產生多筆任務

「新增任務」頁只會建立單一任務。若要從 BOM 批次產生多筆任務，請使用上方「匯入」頁。

### BOM 預覽失敗

請確認:

1. 你已連結 Onshape。
2. URL 是 assembly element 連結，包含 `/e/{elementId}`。
3. 你的 Onshape 帳號有該文件權限。
4. Render 後端已設定 Onshape OAuth 環境變數。

### 為什麼完成後沒有積分

請確認任務真的進入 completed 狀態。只有完成狀態才會入帳。

---

## 14. 目前 M3 進度說明

已完成:

- Onshape OAuth 後端流程
- Onshape token 加密保存
- Onshape 連結狀態查詢
- 解除 Onshape 連結
- Onshape URL 解析
- Onshape document 驗證
- Onshape parts API proxy
- Onshape assembly BOM API proxy
- Onshape thumbnail proxy
- `/import` 匯入頁面
- `POST /api/v1/onshape/import/preview`
- `POST /api/v1/onshape/import`
- BOM row 自動分類自製件 / COTS
- COTS table
- 批次建立/更新任務
- Onshape import batch 記錄
- 建任務時自動保存 Onshape 參照欄位
- 任務詳情頁顯示 Onshape 縮圖
- 前端 header 顯示 Onshape 連結狀態

尚未完成:

- 任務卡直接顯示 thumbnail
- Onshape revision stale 判斷
- Onshape 匯出 DXF / STL / STEP
- Onshape 內嵌側邊面板

因此，這一版比較準確的定位是:

```txt
M3: Onshape 帳號連結、URL 解析、BOM 預覽、COTS 分流、批次建立任務
M4 尚未完成: Onshape 內嵌側邊面板
```
