# 楓之谷收益管理

基於 Serverless 架構開發的網頁應用程式，專為《新楓之谷》玩家設計的 Boss 討伐與收益追蹤儀表板。系統提供角色管理、自動化收益計算、分帳狀態追蹤，以及報表匯出功能。

## 🔹 核心功能

* **身分驗證與資料隔離**：整合 Google 帳號登入，確保每位使用者的資料各自獨立且安全。
* **自動化收益結算**：按照 V273 版本最新 Boss 結晶石基礎價格，可依據「同行隊友」人數自動試算個人結晶收益與寶物分紅。
* **戰況與帳款追蹤**：支援紀錄通關時間、剩餘命數、特定機制備註，並提供「待售出物品」與「待結算帳款」的狀態管理。
* **動態報表與匯出**：
  * 提供「本週/上週/全部」的時間維度篩選（自動依據每週四 00:00 伺服器重置時間計算）。
  * 支援一鍵產生文字版紀錄摘要（複製至剪貼簿）。
  * 支援一鍵匯出 CSV 格式報表，便於進行後續的 Excel 數據分析。

---

## 🔹 使用說明

1. **系統登入**：進入系統網址後，點擊「使用 Google 帳號登入」進行身分驗證。
2. **角色管理**：
   * 首次使用請於左側導覽列點擊「➕ 新增角色」。
   * 點擊角色名稱即可切換當前檢視的儀表板。
   * 點擊角色名稱旁邊的「⚙️」圖示，可修改角色名稱或刪除該角色。
3. **新增紀錄**：
   * 在左側表單選擇討伐目標。
   * 依序填寫同行隊友（無則留空）、通關時間與命數等戰況資訊。
   * 若有掉落高價物品，請填寫物品名稱與售出總價，並標記分帳狀態。
   * 點擊「儲存紀錄」，系統將自動結算並同步至雲端。
4. **報表輸出**：
   * 於明細表上方選擇欲檢視的區間（如：僅顯示本週）。
   * 點擊「複製紀錄摘要」或「匯出 CSV」即可取得結構化資料。

---

## 🔹 系統架構與後台機制

專案採用 **BaaS (Backend as a Service)** 架構，前端畫面由 GitHub Pages 進行靜態代管，後端身分驗證與資料庫則由 Google Firebase 提供服務。

### 1. 身分驗證模組 (Firebase Authentication)
系統停用匿名或自訂 ID 輸入，強制採用 `GoogleAuthProvider` 進行 OAuth 2.0 登入。驗證成功後，系統會取得一組唯一的 `uid` 作為該使用者的存取憑證。

### 2. 資料庫安全規則 (Firestore Security Rules)
為防止未經授權的 API 呼叫或資料竄改，Firestore 後台已配置嚴格的安全規則（Security Rules）。所有的讀取（Read）、寫入（Create/Update）與刪除（Delete）操作，皆需經過雲端伺服器的雙重核驗：
* 要求請求必須包含合法登入憑證 (`request.auth != null`)。
* 要求該憑證的 `uid` 必須與文件內紀錄的 `uid` 完全相符。

**安全規則配置範例：**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /DropRecords/{document} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
      allow create, update: if request.auth != null && request.resource.data.uid == request.auth.uid;
      allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
    }
  }
}
```

### 3. 資料管理方式與檢索邏輯
* **本地與雲端混合儲存**：
  * **角色清單**：使用者的角色名稱陣列儲存於前端的 `localStorage`，以降低不必要的資料庫讀取次數，提升介面切換流暢度。
  * **討伐紀錄**：核心收益紀錄儲存於 Firestore 的 `DropRecords` 集合（Collection）中。
* **複合鍵 (Composite Key) 設計**：
  為避免在 Firestore 中頻繁建立複合索引（Composite Indexes），寫入紀錄時，系統會自動將使用者的 UID 與當前角色名稱組合成專屬鍵值（如：`uid_char_key: "使用者UID_角色名稱"`）。前端發起查詢時，僅需針對此單一欄位進行 `where` 過濾，確保了高效率且精準的資料檢索，同時避免了跨使用者、跨角色的資料污染。

---

## 🔹 開發與部署指南

1. 複製本專案的 `index.html`。
2. 於 Firebase Console 建立新專案，並啟用 **Authentication (Google 供應商)** 與 **Firestore Database**。
3. 將 Firestore 的規則更新為上述的安全規則。
4. 將 `index.html` 內的 `firebaseConfig` 替換環境變數。
5. 將檔案推送至 GitHub Repository，並透過 GitHub Pages 發布，即可完成部署。
