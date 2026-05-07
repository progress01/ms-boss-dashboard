# 楓之谷收益管理

基於 Serverless 架構開發的網頁單頁應用程式（SPA），供《新楓之谷》玩家使用的 Boss 討伐與收益追蹤儀表板。系統提供角色狀態管理、自動化收益計算、分帳狀態追蹤、以及跨裝置的雲端資料同步功能。
參考網址：[https://progress01.github.io/ms-boss-dashboard/](https://progress01.github.io/ms-boss-dashboard/)

## 🔹 核心功能

* **身分驗證與資料隔離**：整合 Firebase OAuth 2.0 (Google 登入)，確保每位使用者的資料各自獨立且安全。
* **自動化收益結算**：內建 V273 版本最新 Boss 結晶石基礎價格，可依據「同行隊友」人數自動分攤計算個人結晶收益。
* **帳款追蹤與自訂掉寶**：支援自訂專屬追蹤物品，並提供「待售出物品」與「未結清帳款」的狀態管理與對帳單輸出。
* **GA 模式動態儀表板與大數據分析**：
  * **帳號總覽**：支援比照 Google Analytics 的時間維度篩選（本週、上週、本月、自訂區間），精準結算全帳號的區間總收益。
  * **團隊綜合歐氣排行榜**：內建掉寶價值換算演算法，統一將台幣/楓幣產值量化為「歐氣指數」，客觀追蹤團隊成員的掉寶貢獻與連摃狀態。
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

專案採用 **BaaS (Backend as a Service)** 架構，前端畫面由 GitHub Pages 進行靜態代管，後端身分驗證與資料庫則由 Google Firebase 提供服務。為應對長期數據增長，系統採用高度模組化與按需讀取設計。

### 1. 模組化目錄結構 (Code Splitting)
系統採用 ES6 Modules 進行職責分離，提升程式碼可維護性：
* `index.html`：純粹的 UI 骨架與視圖層。
* `css/style.css`：集中管理客製化介面樣式。
* `js/config.js`：Firebase 初始化與靜態常數 (如 Boss 價格表)。
* `js/api.js`：專責處理 Firestore 資料庫的 CRUD 操作與快取邏輯。
* `js/app.js`：核心業務邏輯、狀態管理與 DOM 渲染。

### 2. 嚴格的 UI 狀態機 (State Machine)
系統捨棄了依賴裝置的 `localStorage`，全面改用雲端狀態同步。藉由嚴格的路由管控，將介面拆分為三個互斥狀態，徹底消滅「無角色卻進入儀表板」的幽靈狀態：
* **狀態 A (Login)**：未登入驗證。
* **狀態 B (Onboarding)**：已登入但檢測無角色資料，強制攔截建立。
* **狀態 C (Dashboard)**：確保 `activeChar` 存在，渲染專屬儀表板。

### 3. 按需讀取 (Lazy Loading) 與智慧快取
* **設定檔快取**：使用者的靜態設定（角色清單、自訂物品）在登入時建立記憶體快取，避免頻繁切換角色造成的重複讀取。
* **動態區間查詢**：捨棄一次性載入全量歷史資料，改由 `api.js` 根據目前 UI 選擇的「時間維度」向 Firestore 請求特定區間資料，大幅降低資料庫讀取成本 (Reads) 與前端渲染負擔。

### 4. 資料庫安全規則 (Firestore Security Rules)
為防止未經授權的存取，Firestore 後台配置了嚴格的安全規則。所有的讀寫操作皆需經過雲端雙重核驗，確保使用者僅能存取與其 `uid` 相符的數據。

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
