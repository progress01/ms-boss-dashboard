# 楓之谷收益管理

基於 Serverless 架構開發的網頁單頁應用程式（SPA），專為《新楓之谷》玩家設計的 Boss 討伐與收益追蹤儀表板。系統提供角色狀態管理、自動化收益計算、分帳狀態追蹤、以及跨裝置的雲端資料同步功能。
參考網址：[https://progress01.github.io/ms-boss-dashboard/](https://progress01.github.io/ms-boss-dashboard/)

## 🔹 核心功能

* **身分驗證與資料隔離**：整合 Firebase OAuth 2.0 (Google 登入)，確保每位使用者的資料各自獨立且安全。
* **自動化收益結算**：內建 V273 版本最新 Boss 結晶石基礎價格，可依據「同行隊友」人數自動分攤計算個人結晶收益。
* **帳款追蹤與自訂掉寶**：支援自訂專屬追蹤物品，並提供「待售出物品」與「未結清帳款」的狀態管理與對帳單輸出。
* **GA 模式動態儀表板**：
  * **帳號總覽**：支援比照 Google Analytics 的時間維度篩選（本週、上週、本月、自訂區間），精準結算全帳號的區間總收益。
  * **掉寶歐洲度熱力圖**：自動追蹤近 16 週的掉寶頻率，以視覺化網格呈現 RNG 狀態。
* **低耦合第三方傳送門**：無縫整合外部裝備查詢 API (Misaka)，自動帶入當前角色名稱進行外部查詢。

---

## 🔹 使用說明

1. **系統登入與新手上路 (Onboarding)**：
   * 點擊「使用 Google 帳號登入」進行身分驗證。
   * 首次登入或無角色時，系統將強制進入「新手上路」畫面，要求建立第一位主要角色，以確保後續資料關聯的正確性。
2. **角色切換與外部查詢**：
   * 點擊左側導覽列的角色名稱即可無縫切換儀表板，系統會自動記憶「最後活躍角色」，跨裝置登入也能無縫接軌。
   * 點擊主畫面標題旁的「🔍 查裝備」，系統將自動開啟新分頁，導向該角色的外部裝備檢視器。
3. **新增紀錄與客製化設定**：
   * **設定自訂物品**：可透過左下角「⚙️ 設定自訂物品」擴充你的專屬掉寶追蹤清單。
   * **常規討伐**：支援將常打的 Boss 設為「⭐ 常規清單」，方便每週快速打卡。
   * **掉寶帳務**：記錄高價物品售價，並標記分帳狀態（未結清/已結清）。
4. **報表輸出**：
   * 點擊寶物庫右上角的「📋 複製對帳單」，系統將自動彙整當前角色「未結清」的帳目與分錢名單，方便直接貼至 LINE 或 Discord 群組。

---

## 🔹 系統架構與後台機制

專案採用 **BaaS (Backend as a Service)** 架構，前端畫面由 GitHub Pages 進行靜態代管，後端身分驗證與資料庫則由 Google Firebase 提供服務。

### 1. 嚴格的 UI 狀態機 (State Machine)
系統捨棄了依賴裝置的 `localStorage`，全面改用雲端狀態同步。藉由嚴格的路由管控，將介面拆分為三個互斥狀態，徹底消滅「無角色卻進入儀表板」的幽靈狀態：
* **狀態 A (Login)**：未登入驗證。
* **狀態 B (Onboarding)**：已登入但檢測無角色資料，強制攔截建立。
* **狀態 C (Dashboard)**：確保 `activeChar` 存在，渲染專屬儀表板。

### 2. 單一真理來源 (Single Source of Truth) 與向後相容
所有的設定包含角色清單 (`characters`)、最後活躍角色 (`lastActiveChar`)、自訂物品 (`customItems`) 與每週任務進度，皆統一存放於 Firestore 的 `UserSettings` 集合。系統內建**無痛升級 (Silent Migration)** 機制，舊用戶登入時將自動補齊缺失的雲端狀態欄位，不影響既有體驗。

### 3. 資料庫安全規則 (Firestore Security Rules)
為防止未經授權的存取，Firestore 後台配置了嚴格的安全規則。所有的讀寫操作皆需經過雲端雙重核驗，確保使用者僅能存取與其 `uid` 相符的 `UserSettings` 與 `DropRecords` 文件。

**安全規則配置範例：**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 保護使用者個人設定檔
    match /UserSettings/{document} {
      allow read, write: if request.auth != null && document == request.auth.uid;
    }
    // 保護掉寶與收益紀錄
    match /DropRecords/{document} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.uid == request.auth.uid;
    }
  }
}
```

### 4. 複合鍵 (Composite Key) 與低耦合設計
* **資料檢索**：寫入紀錄時，系統自動組合 UID 與角色名稱（`uid_char_key: "UID_角色"`），避免頻繁建立 Firestore 複合索引，實現高效率的 `where` 單一欄位過濾。
* **外部 API 整合**：採用「傳送門 (Portal)」模式取代後端 Fetch。透過 `encodeURIComponent` 動態生成查詢 URL 並新開視窗，既免除了 CORS 與 Rate Limit 的系統風險，又達成了功能擴充的目的。

---

## 🔹 開發與部署指南

1. 複製本專案的 `index.html`。
2. 於 Firebase Console 建立新專案，並啟用 **Authentication (Google 供應商)** 與 **Firestore Database**。
3. 將 Firestore 的 Rules 更新為上述的安全規則。
4. 將 `index.html` 內的 `firebaseConfig` 替換為您的環境變數。
5. 將檔案推送至 GitHub Repository，並透過 GitHub Pages 發布，即可完成部署。
