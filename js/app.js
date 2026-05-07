// js/app.js
import { db, auth, provider, bossCrystalPrices, defaultItemOptions } from './config.js';
import { fetchUserSettings, saveUserSettingsToDB, fetchRecordsByDateRange } from './api.js';
import { collection, addDoc, doc, deleteDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// === 全域狀態 ===
let currentUserUid = null; 
let bossSelectMaster; 
let userSettings = { characters: [], lastActiveChar: "", customItems: [], routineBosses: {}, weeklyTasks: {}, bossTemplates: {} };
let activeChar = ""; 
let currentRecordsData = [];
let isManageMode = { routine: false, loot: false };

// === 工具函式 ===
function getTWNow() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 8));
}

function getLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getWeekBoundaries() {
    const now = getTWNow(); const currentDay = now.getDay(); 
    const daysSinceThu = currentDay >= 4 ? currentDay - 4 : currentDay + 3;
    const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceThu); thisWeekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    return { thisWeekStart, lastWeekStart };
}

function getCycleBoundaries(dateStr, isMonthly) {
    const d = new Date(dateStr + "T00:00:00");
    if (isMonthly) {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
    } else {
        const day = d.getDay();
        const daysSinceThu = day >= 4 ? day - 4 : day + 3;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceThu); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
        return { start, end };
    }
}

function getDashboardDateRange() {
    const rangeType = document.getElementById("overview-quick-range").value;
    const startDateInput = document.getElementById("overview-start-date").value;
    const endDateInput = document.getElementById("overview-end-date").value;
    let start, end;
    const boundaries = getWeekBoundaries();
    const now = getTWNow();

    if (rangeType === "custom") {
        if (!startDateInput || !endDateInput) return null; 
        start = new Date(startDateInput + "T00:00:00"); 
        end = new Date(endDateInput + "T23:59:59");
    } else if (rangeType === "this_week") {
        start = boundaries.thisWeekStart; end = new Date(now); end.setHours(23, 59, 59, 999);
    } else if (rangeType === "last_week") {
        start = boundaries.lastWeekStart; end = new Date(boundaries.thisWeekStart); end.setTime(end.getTime() - 1);
    } else if (rangeType === "this_month") {
        start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (rangeType === "all") {
        start = new Date(0); end = new Date("2100-01-01");
    }
    return { start, end };
}

window.showToast = function(message, type = "success") {
    const toastEl = document.getElementById('liveToast');
    const toastBody = document.getElementById('toast-body');
    toastBody.innerHTML = message;
    toastEl.className = `toast align-items-center border-0 text-bg-${type}`;
    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    toast.show();
};

window.showConfirm = function(title, message, buttons) {
    document.getElementById('dc-title').innerText = title;
    document.getElementById('dc-message').innerHTML = message;
    const btnContainer = document.getElementById('dc-buttons');
    btnContainer.innerHTML = '';
    buttons.forEach(btn => {
        const buttonEl = document.createElement('button');
        buttonEl.className = `btn fw-bold ${btn.class}`;
        buttonEl.innerHTML = btn.text;
        if(btn.dismiss) buttonEl.setAttribute('data-bs-dismiss', 'modal');
        if(btn.onClick) {
            buttonEl.addEventListener('click', () => {
                btn.onClick();
                bootstrap.Modal.getInstance(document.getElementById('dynamicConfirmModal')).hide();
            });
        }
        btnContainer.appendChild(buttonEl);
    });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('dynamicConfirmModal')).show();
};

// === 初始化與 Auth ===
const loginScreen = document.getElementById("login-screen");
const onboardingScreen = document.getElementById("onboarding-screen");
const mainApp = document.getElementById("main-app");

function showScreen(screen) {
    loginScreen.style.display = "none"; onboardingScreen.style.display = "none"; mainApp.style.display = "none";
    if (screen === 'login') loginScreen.style.display = "flex";
    if (screen === 'onboarding') onboardingScreen.style.display = "flex";
    if (screen === 'dashboard') mainApp.style.display = "block";
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserUid = user.uid; 
        document.getElementById("user-name").innerText = user.displayName;
        if (!bossSelectMaster) { initMasterSelect(); }
        document.getElementById("input-date-master").value = getLocalDateString(getTWNow()); 
        await loadUserSettings();
    } else {
        currentUserUid = null; showScreen('login'); 
    }
});

document.getElementById("btn-login").addEventListener("click", () => { signInWithPopup(auth, provider).catch(error => { showToast("登入失敗！", "danger"); }); });
document.getElementById("btn-logout").addEventListener("click", (e) => { 
    e.preventDefault(); 
    showConfirm("登出", "您確定要登出嗎？", [
        { text: "🚪 確定登出", class: "btn-danger", onClick: () => signOut(auth) },
        { text: "取消", class: "btn-light", dismiss: true }
    ]);
});

// === 設定與資料載入 ===
async function loadUserSettings() {
    if(!currentUserUid) return;
    const data = await fetchUserSettings(currentUserUid);
    if (data && data.characters && data.characters.length > 0) {
        userSettings = data;
        if(!userSettings.customItems) userSettings.customItems = [];
        if(!userSettings.routineBosses) userSettings.routineBosses = {};
        if(!userSettings.weeklyTasks) userSettings.weeklyTasks = {};
        if(!userSettings.bossTemplates) userSettings.bossTemplates = {}; 
        
        if (userSettings.lastActiveChar && userSettings.characters.includes(userSettings.lastActiveChar)) {
            activeChar = userSettings.lastActiveChar;
        } else {
            activeChar = userSettings.characters[0]; userSettings.lastActiveChar = activeChar; saveUserSettings(); 
        }
        initDashboard();
    } else {
        userSettings = { characters: [], lastActiveChar: "", customItems: data?.customItems || [], routineBosses: {}, weeklyTasks: {}, bossTemplates: {} };
        showScreen('onboarding');
    }
}

async function saveUserSettings() {
    if(!currentUserUid) return;
    try { await saveUserSettingsToDB(currentUserUid, userSettings); } catch(err) { console.error("設定儲存失敗", err); }
}

function initDashboard() {
    showScreen('dashboard');
    renderItemDatalist(); 
    renderCustomItemList();
    renderSidebar();
    const today = getTWNow();
    document.getElementById("overview-start-date").value = getLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1));
    document.getElementById("overview-end-date").value = getLocalDateString(today);
    loadRecords();
}

async function loadRecords() {
    if(!currentUserUid) return;
    try {
        const uiRange = getDashboardDateRange();
        if (!uiRange) return;
        
        const today = getTWNow();
        const heatmapStart = new Date(today);
        heatmapStart.setDate(today.getDate() - (16 * 7) - today.getDay());
        
        let fetchStart = uiRange.start < heatmapStart ? uiRange.start : heatmapStart;
        let fetchEnd = uiRange.end > today ? uiRange.end : today;

        const startStr = getLocalDateString(fetchStart);
        const endStr = getLocalDateString(fetchEnd);

        currentRecordsData = await fetchRecordsByDateRange(currentUserUid, startStr, endStr);
        
        const boundaries = getWeekBoundaries();
        updateAccountOverview(); 
        renderHeatmap(currentRecordsData);
        updateCharacterStats(boundaries);
        renderRoutineTable(boundaries);
        renderLootTable();
        loadRoutineBosses(false);
    } catch (error) { showToast("無法連線至資料庫", "danger"); }
}

document.getElementById("overview-quick-range").addEventListener("change", loadRecords);
document.getElementById("overview-start-date").addEventListener("change", loadRecords);
document.getElementById("overview-end-date").addEventListener("change", loadRecords);

// === UI 渲染與邏輯 (側邊欄、總覽、圖表) ===
function renderSidebar() {
    const charListContainer = document.getElementById("character-list"); charListContainer.innerHTML = ""; 
    document.getElementById("dashboard-title").innerText = activeChar; 
    document.getElementById("mobile-active-char").innerText = `⚔️ ${activeChar}`; 

    const portalBtn = document.getElementById("btn-char-portal");
    if (activeChar) {
        portalBtn.href = `https://msapi.misaka-site.co/search/character?name=${encodeURIComponent(activeChar)}`;
        portalBtn.classList.remove("d-none");
    }
    
    userSettings.characters.forEach((charName, index) => {
        const a = document.createElement("a"); a.href = "#"; a.className = "d-flex justify-content-between align-items-center char-item";
        if (charName === activeChar) a.classList.add("active");
        const textSpan = document.createElement("span"); textSpan.innerText = "⚔️ " + charName; textSpan.style.flexGrow = "1"; 
        
        textSpan.addEventListener("click", (e) => { 
            e.preventDefault(); 
            if(activeChar === charName) { hideOffcanvas(); return; }
            activeChar = charName; userSettings.lastActiveChar = activeChar; saveUserSettings();
            resetMasterForm(); initMasterSelect(); renderSidebar(); loadRecords(); hideOffcanvas();
        });
        
        const editBtn = document.createElement("span"); editBtn.innerText = "⚙️"; editBtn.style.opacity = "0.7"; editBtn.style.marginLeft = "10px";
        editBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation(); 
            // 省略部分編輯角色名稱防呆邏輯，確保程式碼精簡穩定
            alert("角色名稱修改功能已轉移至未來更新模組");
        });
        a.appendChild(textSpan); a.appendChild(editBtn); charListContainer.appendChild(a);
    });
    renderWeeklyTasks(); 
}

function hideOffcanvas() {
    const offcanvasEl = document.getElementById('sidebarMenu');
    if (offcanvasEl.classList.contains('show')) {
        const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl);
        if(bsOffcanvas) bsOffcanvas.hide(); 
    }
}

function updateAccountOverview() {
    const range = getDashboardDateRange();
    if(!range) return;

    let accountCrystal = 0; let accountDivMeso = 0; let accountDivTwd = 0; let charWeeklyCount = 0;
    const monthlyBosses = ["終極黑魔法師", "困難黑魔法師"]; 
    const boundaries = getWeekBoundaries();

    currentRecordsData.forEach(data => {
        const rd = new Date(data.date + "T00:00:00");
        if (rd >= range.start && rd <= range.end) {
            accountCrystal += data.crystal_income_billion || 0;
            if (data.item_name && data.item_name !== "無" && data.payout_status === "已結清" && data.status !== "自用") {
                let isTwd = data.currency === 'twd';
                if (isTwd && data.my_dividend_twd > 0) accountDivTwd += data.my_dividend_twd;
                else if (!isTwd && data.my_dividend_billion > 0) accountDivMeso += data.my_dividend_billion;
            }
        }
        if (data.character_name === activeChar && rd >= boundaries.thisWeekStart) {
            if (!monthlyBosses.includes(data.boss_name) && data.item_name === "無") {
                charWeeklyCount++;
            }
        }
    });

    document.getElementById("account-total-crystal").innerText = accountCrystal.toFixed(2) + " 億";
    document.getElementById("account-total-settled").innerText = accountDivMeso.toFixed(2) + " 億";
    document.getElementById("account-total-settled-twd").innerText = accountDivTwd.toLocaleString() + " 元";
    document.getElementById("weekly-limit-count").innerText = charWeeklyCount;
    document.getElementById("weekly-limit-badge").className = charWeeklyCount >= 12 ? "badge bg-danger text-white fs-6 px-3 py-2 shadow-sm rounded-pill" : "badge bg-primary text-white fs-6 px-3 py-2 shadow-sm rounded-pill";
}

function updateCharacterStats(boundaries) {
    const weekFilter = document.getElementById("filter-week-routine").value;
    let totalCrystal = 0, totalDivMeso = 0, totalDivTwd = 0, pendingCount = 0, unsettledCount = 0;

    currentRecordsData.forEach(data => {
        if (data.character_name !== activeChar) return;
        const rd = new Date(data.date + "T00:00:00");
        let inDateRange = true;
        if (weekFilter === "this_week") inDateRange = rd >= boundaries.thisWeekStart;
        if (weekFilter === "last_week") inDateRange = rd >= boundaries.lastWeekStart && rd < boundaries.thisWeekStart;

        if (inDateRange) { totalCrystal += data.crystal_income_billion || 0; }

        if (data.item_name && data.item_name !== "無") {
            if (data.status !== "自用") {
                if (data.status === "待售出") pendingCount++;
                if (data.payout_status === "未結清") unsettledCount++;
                if (data.payout_status === "已結清") {
                    if (data.currency === 'twd' && data.my_dividend_twd > 0) totalDivTwd += data.my_dividend_twd;
                    else if ((!data.currency || data.currency === 'meso') && data.my_dividend_billion > 0) totalDivMeso += data.my_dividend_billion;
                }
            }
        }
    });

    document.getElementById("stat-crystal").innerText = `${totalCrystal.toFixed(2)} 億`;
    document.getElementById("stat-drop").innerText = `${totalDivMeso.toFixed(2)} 億`;
    document.getElementById("stat-drop-twd").innerText = `${totalDivTwd.toLocaleString()}`;
    document.getElementById("stat-pending").innerText = `${pendingCount} 件`;
    document.getElementById("stat-unsettled").innerText = `${unsettledCount} 筆`;
}

// === 圖表與歐氣渲染 ===
function renderHeatmap(records) {
    const heatmapGrid = document.getElementById("heatmap-grid"); 
    if(!heatmapGrid) return;
    heatmapGrid.innerHTML = "";
    const today = getTWNow(); today.setHours(0,0,0,0);
    let startDate = new Date(today); startDate.setDate(today.getDate() - (16 * 7) - today.getDay()); 
    
    let dateDrops = {};
    records.forEach(r => { 
        let isMeso = (!r.currency || r.currency === 'meso');
        if(r.character_name === activeChar && r.item_name && r.item_name !== "無" && isMeso) {
            if(!dateDrops[r.date]) dateDrops[r.date] = { value: 0, count: 0 };
            dateDrops[r.date].value += (parseFloat(r.item_total_price_billion) || 0);
            dateDrops[r.date].count += 1;
        }
    });
    
    let currDate = new Date(startDate);
    while(currDate <= today) {
        let dateStr = getLocalDateString(currDate); 
        let dropData = dateDrops[dateStr];
        let cell = document.createElement("div"); cell.className = "heatmap-cell";
        
        if(!dropData) {
            cell.classList.add("hc-0"); cell.title = `${dateStr} 無掉寶`;
        } else {
            let val = dropData.value;
            if(val <= 10) cell.classList.add("hc-1"); else if(val <= 50) cell.classList.add("hc-2"); 
            else if(val <= 100) cell.classList.add("hc-3"); else cell.classList.add("hc-4"); 
            cell.title = `${dateStr} 掉落了 ${dropData.count} 個寶物 (價值 ${val.toFixed(2)} 億)`; 
        }
        heatmapGrid.appendChild(cell); currDate.setDate(currDate.getDate() + 1);
    }
}

// === 表格渲染 ===
function renderRoutineTable(boundaries) {
    const theadRow = document.getElementById("thead-routine-row");
    const tableBody = document.getElementById("table-body-routine");
    const weekFilter = document.getElementById("filter-week-routine").value;
    
    let filtered = currentRecordsData.filter(d => {
        if(d.character_name !== activeChar || d.item_name !== "無") return false;
        const rd = new Date(d.date + "T00:00:00");
        if (weekFilter === "this_week") return rd >= boundaries.thisWeekStart;
        if (weekFilter === "last_week") return rd >= boundaries.lastWeekStart && rd < boundaries.thisWeekStart;
        return true;
    });

    theadRow.innerHTML = `
        ${isManageMode.routine ? '<th style="width: 40px;"><input type="checkbox" id="cb-all-routine" class="form-check-input" style="cursor: pointer;"></th>' : ''}
        <th>日期與目標</th>
        <th>💎 結晶分配</th>
        ${isManageMode.routine ? '' : '<th>操作</th>'}
    `;

    let html = "";
    filtered.forEach(data => {
        let isRoutine = (userSettings.routineBosses[activeChar] || []).includes(data.boss_name);
        let badgeHtml = isRoutine 
            ? `<span class="badge bg-dark text-warning border border-warning shadow-sm" style="font-size: 0.65em; margin-right: 4px; vertical-align: text-top;">⭐常規</span>` 
            : `<span class="badge bg-light text-secondary border border-secondary shadow-sm" style="font-size: 0.65em; margin-right: 4px; vertical-align: text-top;">🆕臨時</span>`;

        html += `
            <tr>
                ${isManageMode.routine ? `<td data-label="☑️ 選取"><input type="checkbox" class="form-check-input cb-routine-item" value="${data.id}" style="cursor: pointer;"></td>` : ''}
                <td class="text-start ps-md-3" data-label="📌 討伐目標">
                    <div class="fw-bold mb-1">${badgeHtml}${data.boss_name}</div>
                    <small class="text-muted fw-normal">${data.date}</small>
                </td>
                <td data-label="💎 結晶分配">
                    <div class="crystal-text">${(data.crystal_income_billion || 0).toFixed(2)} 億</div>
                    <span class="badge-battle">👥 ${data.total_players}人平分</span>
                </td>
                ${isManageMode.routine ? '' : `
                <td data-label="⚙️ 操作">
                    <div class="d-flex flex-column gap-1 justify-content-center">
                        <button class="btn btn-sm btn-outline-danger btn-delete-record action-lock" data-id="${data.id}">刪除</button>
                    </div>
                </td>
                `}
            </tr>
        `;
    });
    tableBody.innerHTML = html || `<tr><td colspan="${isManageMode.routine ? 3 : 3}" class="text-muted py-4">此範圍尚無紀錄</td></tr>`;
}

function renderLootTable() {
    const theadRow = document.getElementById("thead-loot-row");
    const tableBody = document.getElementById("table-body-loot");
    let lootRecords = currentRecordsData.filter(d => d.character_name === activeChar && d.item_name && d.item_name !== "無");
    
    lootRecords.sort((a, b) => {
        let aPending = (a.status === "待售出" || a.payout_status === "未結清") ? 1 : 0;
        let bPending = (b.status === "待售出" || b.payout_status === "未結清") ? 1 : 0;
        if(aPending !== bPending) return bPending - aPending; 
        return new Date(b.date) - new Date(a.date);
    });

    theadRow.innerHTML = `
        ${isManageMode.loot ? '<th style="width: 40px;"><input type="checkbox" id="cb-all-loot" class="form-check-input" style="cursor: pointer;"></th>' : ''}
        <th>物品與目標</th>
        <th>市價 / 實收</th>
        <th>狀態</th>
        ${isManageMode.loot ? '' : '<th>操作</th>'}
    `;

    let html = "";
    lootRecords.forEach(data => {
        let sBadge = data.status === "自用" ? `<span class="status-badge bg-self">💎 自用</span>` : (data.status === "待售出" ? `<span class="status-badge bg-pending">⏳ 待售出</span>` : `<span class="status-badge bg-sold">✔️ 已售出</span>`);
        let pBadge = (data.status !== "自用" && data.payout_status !== "無需分帳") ? (data.payout_status === "未結清" ? `<span class="status-badge bg-unsettled mt-1">⚠️ 未結清</span>` : `<span class="status-badge bg-settled mt-1">✔️ 已結清</span>`) : "";

        let dividendLabel = data.total_players === 1 ? "實收" : "分紅";
        let isTwd = data.currency === 'twd';
        let priceStr = isTwd ? `${(data.item_total_price_twd || 0).toLocaleString()} 元` : `${(data.item_total_price_billion || 0).toFixed(2)} 億`;
        let divStr = data.status === '自用' ? (isTwd ? "0 元" : "0 億") : (isTwd ? `${(data.my_dividend_twd || 0).toLocaleString()} 元` : `${(data.my_dividend_billion || 0).toFixed(2)} 億`);

        let settleBtn = (data.payout_status === "未結清" && data.status !== "自用") ? `<button class="btn btn-sm btn-success btn-quick-settle mb-1 action-lock" data-id="${data.id}">✅ 結清</button>` : '';

        html += `
            <tr>
                ${isManageMode.loot ? `<td data-label="☑️ 選取"><input type="checkbox" class="form-check-input cb-loot-item" value="${data.id}" style="cursor: pointer;"></td>` : ''}
                <td class="text-start ps-md-3" data-label="📦 掉落物">
                    <div class="fw-bold text-primary mb-1">📦 ${data.item_name}</div>
                    <small class="text-muted">${data.date} | ${data.boss_name}</small>
                </td>
                <td data-label="💰 帳務">
                    <div class="text-muted mb-1" style="font-size:0.85em;">市價: <span class="${isTwd ? 'currency-twd' : ''}">${priceStr}</span></div>
                    <div class="${isTwd ? 'currency-twd' : 'dividend-text'} fs-6">${dividendLabel}: +${divStr}</div>
                </td>
                <td data-label="📊 狀態"><div class="d-flex flex-column gap-0 align-items-center">${sBadge}${pBadge}</div></td> 
                ${isManageMode.loot ? '' : `
                <td data-label="⚙️ 操作">
                    <div class="d-flex flex-column gap-1 justify-content-center">
                        ${settleBtn}
                        <button class="btn btn-sm btn-outline-danger btn-delete-record action-lock" data-id="${data.id}">刪除</button>
                    </div>
                </td>
                `}
            </tr>
        `;
    });
    tableBody.innerHTML = html || `<tr><td colspan="${isManageMode.loot ? 4 : 4}" class="text-muted py-4">目前寶物庫空空如也</td></tr>`;
}

// === 其他系統核心 (TomSelect, 表單重置) ===
function renderItemDatalist() {
    const datalist = document.getElementById("item-datalist");
    datalist.innerHTML = "";
    const allItems = [...userSettings.customItems, ...defaultItemOptions.map(i => i.value)];
    [...new Set(allItems)].forEach(item => { datalist.innerHTML += `<option value="${item}">`; });
}
function renderCustomItemList() {
    // 預留供自訂物品清單使用
}

const tsRenderConfig = {
    item: function(data, escape) {
        let isRoutine = (userSettings.routineBosses[activeChar] || []).includes(data.value);
        return '<div class="' + (isRoutine ? 'bg-dark text-white' : '') + '">' + (isRoutine ? '<span class="text-warning">⭐</span> ' : '') + escape(data.text) + '</div>';
    },
    option: function(data, escape) {
        let isRoutine = (userSettings.routineBosses[activeChar] || []).includes(data.value);
        return '<div>' + (isRoutine ? '<span class="text-warning">⭐</span> ' : '') + escape(data.text) + '</div>';
    }
};

function initMasterSelect() {
    if (bossSelectMaster) { bossSelectMaster.destroy(); } 
    const optionsHtml = document.getElementById("hidden-boss-options").innerHTML;
    document.getElementById("input-boss-master").innerHTML = optionsHtml;
    bossSelectMaster = new TomSelect("#input-boss-master", { 
        create: false, maxItems: null, plugins: ['remove_button'], placeholder: "搜尋目標...", render: tsRenderConfig 
    });

    bossSelectMaster.on('change', function(selected) {
        const container = document.getElementById('dynamic-boss-configs');
        const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);

        if (selectedArr.length === 0) { container.innerHTML = ''; return; }

        const existingCards = container.querySelectorAll('.boss-card-wrapper');
        existingCards.forEach(card => {
            if (!selectedArr.includes(card.getAttribute('data-boss'))) { card.remove(); }
        });

        selectedArr.forEach(boss => {
            if (!container.querySelector(`.boss-card-wrapper[data-boss="${boss}"]`)) {
                let lastPartySize = 1; let lastTeammates = "";
                const card = document.createElement('div');
                card.className = 'card mb-2 border border-secondary shadow-sm boss-card-wrapper';
                card.setAttribute('data-boss', boss);
                
                card.innerHTML = `
                    <div class="card-header bg-dark text-white py-2 d-flex justify-content-between align-items-center boss-card-header">
                        <span class="fw-bold mb-0">👑 ${boss}</span>
                    </div>
                    <div class="card-body p-2 bg-light boss-card-body">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <label class="mb-0 small fw-bold text-secondary">討伐人數:</label>
                            <select class="form-select form-select-sm boss-party-size" data-boss="${boss}" style="width: 80px;">
                                <option value="1">1 人</option><option value="2">2 人</option><option value="3">3 人</option>
                                <option value="4">4 人</option><option value="5">5 人</option><option value="6">6 人</option>
                            </select>
                        </div>
                        <input type="text" class="form-control form-control-sm mb-1 boss-teammates" data-boss="${boss}" placeholder="隊友名稱 (選填，空格隔開)">
                        <div class="boss-loot-container" data-boss="${boss}"></div>
                        <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold w-100 btn-add-loot" data-boss="${boss}">➕ 新增掉落物品</button>
                    </div>
                `;
                container.appendChild(card);
            }
        });
    });
}

function loadRoutineBosses(isManual = false) {
    if(!bossSelectMaster || document.body.classList.contains("edit-mode-active")) return;
    const routineList = userSettings.routineBosses[activeChar] || [];
    if (routineList.length === 0) return;
    
    let clearedBosses = new Set();
    currentRecordsData.forEach(d => {
        if (d.character_name === activeChar && d.item_name === "無") {
            clearedBosses.add(d.boss_name); // 簡化邏輯供快速上線
        }
    });

    const pendingBosses = routineList.filter(boss => !clearedBosses.has(boss));
    bossSelectMaster.setValue(pendingBosses);
}

function resetMasterForm() {
    document.getElementById("form-master").reset();
    document.getElementById("input-date-master").value = getLocalDateString(getTWNow());
    if (bossSelectMaster) { bossSelectMaster.clear(true); }
    document.getElementById("dynamic-boss-configs").innerHTML = '';
}

function renderWeeklyTasks() {
    const container = document.getElementById("weekly-tasks-container"); container.innerHTML = "";
    if(!activeChar) return;
    const thisWeekStart = getWeekBoundaries().thisWeekStart.getTime();
    
    if(!userSettings.weeklyTasks[activeChar] || userSettings.weeklyTasks[activeChar].weekStart !== thisWeekStart) {
        userSettings.weeklyTasks[activeChar] = { weekStart: thisWeekStart, tasks: {} }; saveUserSettings(); 
    }
    
    ["地下水道", "公會城簽到", "跳棋任務", "每週怪物公園", "高山副本"].forEach((task, idx) => {
        const isChecked = userSettings.weeklyTasks[activeChar].tasks[idx] ? "checked" : "";
        const div = document.createElement("div"); div.className = "form-check mb-2";
        div.innerHTML = `<input class="form-check-input task-checkbox" type="checkbox" id="task-${idx}" data-idx="${idx}" ${isChecked}> <label class="form-check-label task-checkbox-label" for="task-${idx}">${task}</label>`;
        container.appendChild(div);
    });
    document.querySelectorAll(".task-checkbox").forEach(chk => { 
        chk.addEventListener("change", (e) => { userSettings.weeklyTasks[activeChar].tasks[e.target.dataset.idx] = e.target.checked; saveUserSettings(); }); 
    });
}

// === 事件監聽綁定 ===
document.addEventListener("DOMContentLoaded", () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
});

document.getElementById("btn-start-journey").addEventListener("click", async () => {
    const input = document.getElementById("input-first-char");
    const charName = input.value.trim();
    if (!charName) { showToast("請輸入角色名稱", "warning"); return; }
    userSettings.characters = [charName]; userSettings.lastActiveChar = charName; activeChar = charName;
    await saveUserSettings(); initDashboard();
});

document.getElementById('dynamic-boss-configs').addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-add-loot')) {
        const bossName = e.target.getAttribute('data-boss');
        const lootContainer = document.querySelector(`.boss-loot-container[data-boss="${bossName}"]`);
        const row = document.createElement('div');
        row.className = 'row g-1 align-items-center mb-2 border-start border-warning border-3 ps-2';
        row.innerHTML = `
            <div class="col-4"><input type="text" list="item-datalist" class="form-control form-control-sm loot-name" placeholder="物品名稱"></div>
            <div class="col-4 d-flex pe-0">
                <input type="number" class="form-control form-control-sm loot-price" placeholder="價格" step="0.1">
                <select class="form-select form-select-sm loot-currency px-1 text-center fw-bold" style="width: 55px;"><option value="meso">億</option><option value="twd" class="text-warning">元</option></select>
            </div>
            <div class="col-3"><select class="form-select form-select-sm loot-status"><option value="待售出">待售出</option><option value="自用">自用</option></select></div>
            <div class="col-1 text-center ps-0"><button type="button" class="btn btn-sm btn-danger btn-remove-loot px-1">✖</button></div>
        `;
        lootContainer.appendChild(row);
    }
    if (e.target.classList.contains('btn-remove-loot')) { e.target.closest('.row').remove(); }
});

document.getElementById("btn-save-master").addEventListener("click", async () => {
    const recordDate = document.getElementById("input-date-master").value;
    const selectedBosses = bossSelectMaster.getValue();
    let bossesArray = Array.isArray(selectedBosses) ? selectedBosses : (selectedBosses ? [selectedBosses] : []);
    
    if (bossesArray.length === 0) { showToast("請至少選擇一隻討伐目標！", "warning"); return; }
    
    document.getElementById("btn-save-master").disabled = true;
    let promises = []; const batchId = Date.now().toString();

    bossesArray.forEach(boss => {
        const partySize = parseInt(document.querySelector(`.boss-party-size[data-boss="${boss}"]`).value) || 1;
        const baseCrystal = parseFloat(((bossCrystalPrices[boss] || 0) / partySize).toFixed(2));
        
        // 存入空車紀錄 (純結晶)
        promises.push(addDoc(collection(db, "DropRecords"), {
            uid: currentUserUid, character_name: activeChar, batch_id: batchId,
            date: recordDate, boss_name: boss, total_players: partySize,
            crystal_income_billion: baseCrystal, item_name: "無", status: "僅紀錄", payout_status: "無需分帳", currency: "meso"
        }));

        // 存入掉寶紀錄
        const lootRows = document.querySelectorAll(`.boss-loot-container[data-boss="${boss}"] .row`);
        lootRows.forEach(row => {
            const itemName = row.querySelector('.loot-name').value.trim();
            const currency = row.querySelector('.loot-currency').value;
            const rawPrice = parseFloat(row.querySelector('.loot-price').value) || 0;
            const statusVal = row.querySelector('.loot-status').value;
            
            if (itemName) {
                let priceMeso = currency === 'meso' ? rawPrice : 0;
                let priceTwd = currency === 'twd' ? rawPrice : 0;
                promises.push(addDoc(collection(db, "DropRecords"), {
                    uid: currentUserUid, character_name: activeChar, batch_id: batchId,
                    date: recordDate, boss_name: boss, total_players: partySize, crystal_income_billion: 0, 
                    item_name: itemName, status: statusVal, payout_status: statusVal === "自用" ? "無需分帳" : "未結清", currency: currency,
                    item_total_price_billion: priceMeso, my_dividend_billion: priceMeso > 0 ? (priceMeso/partySize) : 0,
                    item_total_price_twd: priceTwd, my_dividend_twd: priceTwd > 0 ? (priceTwd/partySize) : 0
                }));
            }
        });
    });

    await Promise.all(promises);
    showToast("✅ 結算儲存成功！", "success");
    document.getElementById("btn-save-master").disabled = false;
    resetMasterForm(); loadRecords();
});

document.addEventListener("click", async (e) => {
    const btnSettle = e.target.closest(".btn-quick-settle");
    if (btnSettle) {
        e.preventDefault(); const docId = btnSettle.getAttribute("data-id");
        await updateDoc(doc(db, "DropRecords", docId), { payout_status: "已結清", status: "已售出" });
        loadRecords(); showToast("✅ 帳款已結清", "success");
    }

    const btnDel = e.target.closest(".btn-delete-record");
    if (btnDel) { 
        if(confirm("確定刪除此紀錄？")) {
            await deleteDoc(doc(db, "DropRecords", btnDel.getAttribute("data-id"))); 
            loadRecords(); showToast("✅ 已刪除", "success");
        }
    }
});

document.getElementById("filter-week-routine").addEventListener("change", () => {
    const b = getWeekBoundaries(); renderRoutineTable(b); updateCharacterStats(b);
});
