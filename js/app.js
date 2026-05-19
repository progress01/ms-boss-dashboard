// js/app.js
import { db, auth, provider, bossCrystalPrices, defaultItemOptions } from './config.js';
import { fetchUserSettings, saveUserSettingsToDB, fetchRecordsByDateRange } from './api.js';
import { collection, addDoc, query, where, getDocs, doc, deleteDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// === 全域狀態 ===
let currentUserUid = null; 
let bossSelectMaster; 
let userSettings = { characters: [], lastActiveChar: "", customItems: [], routineBosses: {}, weeklyTasks: {}, bossTemplates: {}, bossAliases: {} };
let activeChar = ""; 
let currentRecordsData = [];
let isManageMode = { routine: false, loot: false, listEdit: false };

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

function updateCountdowns() {
    const now = getTWNow();
    let daysToNextThu = (4 - now.getDay() + 7) % 7; 
    let nextThu = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToNextThu); nextThu.setHours(0, 0, 0, 0);
    if (now.getTime() >= nextThu.getTime()) nextThu.setDate(nextThu.getDate() + 7);
    
    let nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); nextMonth.setHours(0, 0, 0, 0);
    const formatDiff = (target) => { const diff = target - now; return `${Math.floor(diff / 86400000)}天 ${Math.floor((diff / 3600000) % 24)}時 ${Math.floor((diff / 60000) % 60)}分`; };
    
    const wTimer = document.getElementById("reset-timer-week");
    const mTimer = document.getElementById("reset-timer-month");
    if(wTimer) wTimer.innerText = formatDiff(nextThu);
    if(mTimer) mTimer.innerText = formatDiff(nextMonth);
}
setInterval(updateCountdowns, 60000); updateCountdowns();

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

window.deleteCustomItem = function(index) {
    userSettings.customItems.splice(index, 1);
    saveUserSettings(); renderCustomItemList(); renderItemDatalist();
}

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
        
        if(!userSettings.bossAliases) {
            userSettings.bossAliases = {
                "困狗": "混沌監視者卡洛斯", "極狗": "終極監視者卡洛斯",
                "困賽": "困難受選的賽蓮", "極賽": "終極受選的賽蓮",
                "困黑": "困難黑魔法師", "極黑": "終極黑魔法師",
                "困咖": "困難咖凌", "極咖": "終極咖凌", "普狗": "普通監視者卡洛斯",
                "簡狗": "簡單監視者卡洛斯", "困眼": "混沌戴斯克", "困綠": "混沌守護天使綠水靈"
            };
        }
        
        if (userSettings.lastActiveChar && userSettings.characters.includes(userSettings.lastActiveChar)) {
            activeChar = userSettings.lastActiveChar;
        } else {
            activeChar = userSettings.characters[0]; userSettings.lastActiveChar = activeChar; saveUserSettings(); 
        }
        initDashboard();
    } else {
        userSettings = { characters: [], lastActiveChar: "", customItems: data?.customItems || [], routineBosses: {}, weeklyTasks: {}, bossTemplates: {}, bossAliases: {} };
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

        currentRecordsData = await fetchRecordsByDateRange(currentUserUid, getLocalDateString(fetchStart), getLocalDateString(fetchEnd));
        
        const localFilter = document.getElementById("filter-week-routine");
        if(localFilter) {
            localFilter.disabled = true;
            localFilter.innerHTML = '<option value="sync">🔄 已與右上角同步</option>';
        }

        updateAccountOverview(); 
        renderHeatmap(currentRecordsData);
        updateCharacterStats(); 
        renderRoutineTable();   
        renderLootTable();      
        loadRoutineBosses(false);
        renderLuckBoard(); 
        
    } catch (error) { showToast("無法連線至資料庫", "danger"); }
}

document.getElementById("overview-quick-range").addEventListener("change", loadRecords);
document.getElementById("overview-start-date").addEventListener("change", loadRecords);
document.getElementById("overview-end-date").addEventListener("change", loadRecords);

// === 側邊欄與視圖 ===
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
            if (document.body.classList.contains("edit-mode-active")) {
                showConfirm("切換角色", "您正在編輯模式中，切換角色將放棄目前變更。確定切換？", [
                    { text: "切換", class: "btn-primary", onClick: () => { activeChar = charName; userSettings.lastActiveChar = activeChar; saveUserSettings(); resetMasterForm(); initMasterSelect(); renderSidebar(); loadRecords(); hideOffcanvas(); }},
                    { text: "取消", class: "btn-light", dismiss: true }
                ]);
                return;
            }
            activeChar = charName; userSettings.lastActiveChar = activeChar; saveUserSettings();
            resetMasterForm(); initMasterSelect(); renderSidebar(); loadRecords(); hideOffcanvas();
        });
        
        const editBtn = document.createElement("span"); editBtn.innerText = "⚙️"; editBtn.style.opacity = "0.7"; editBtn.style.marginLeft = "10px";
        editBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation(); 
            const action = prompt(`修改角色名稱：\n(清空可刪除角色)`, charName);
            if (action === null) return; 
            if (action.trim() === "") { 
                showConfirm("刪除角色", `確定移除【${charName}】嗎？`, [
                    { text: "移除", class: "btn-danger", onClick: () => {
                        userSettings.characters.splice(index, 1); 
                        if (userSettings.characters.length === 0) { userSettings.lastActiveChar = ""; saveUserSettings(); showScreen('onboarding'); return; } 
                        else { activeChar = userSettings.characters[0]; userSettings.lastActiveChar = activeChar; }
                        resetMasterForm(); saveUserSettings(); renderSidebar(); loadRecords(); 
                    }},
                    { text: "取消", class: "btn-light", dismiss: true }
                ]);
            } else { 
                const newCharName = action.trim();
                if(newCharName !== charName) {
                    if(userSettings.characters.includes(newCharName)) { showToast("角色名稱已存在！", "warning"); return; }
                    userSettings.characters[index] = newCharName; 
                    if (activeChar === charName) { activeChar = newCharName; userSettings.lastActiveChar = activeChar; }
                    saveUserSettings(); renderSidebar(); loadRecords(); 
                }
            }
            hideOffcanvas();
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

document.getElementById("btn-add-char").addEventListener("click", async (e) => { 
    e.preventDefault(); const newChar = prompt("新角色名稱："); 
    if (newChar && newChar.trim() !== "") { 
        const charName = newChar.trim();
        if (!userSettings.characters.includes(charName)) { userSettings.characters.push(charName); }
        activeChar = charName; userSettings.lastActiveChar = activeChar; 
        await saveUserSettings(); resetMasterForm(); renderSidebar(); loadRecords(); hideOffcanvas();
    } 
});

function updateAccountOverview() {
    const rangeType = document.getElementById("overview-quick-range").value;
    const startDateInput = document.getElementById("overview-start-date");
    const endDateInput = document.getElementById("overview-end-date");
    const separator = document.getElementById("overview-date-separator");

    if (rangeType === "custom") {
        startDateInput.classList.remove("d-none"); endDateInput.classList.remove("d-none"); separator.classList.remove("d-none");
    } else {
        startDateInput.classList.add("d-none"); endDateInput.classList.add("d-none"); separator.classList.add("d-none");
    }

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

function updateCharacterStats() {
    const range = getDashboardDateRange();
    if (!range) return;

    let totalCrystal = 0, totalDivMeso = 0, totalDivTwd = 0, pendingCount = 0, unsettledCount = 0;

    currentRecordsData.forEach(data => {
        if (data.character_name !== activeChar) return;
        const rd = new Date(data.date + "T00:00:00");
        
        if (rd >= range.start && rd <= range.end) { 
            totalCrystal += data.crystal_income_billion || 0; 

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
        }
    });

    document.getElementById("stat-crystal").innerText = `${totalCrystal.toFixed(2)} 億`;
    document.getElementById("stat-drop").innerText = `${totalDivMeso.toFixed(2)} 億`;
    document.getElementById("stat-drop-twd").innerText = `${totalDivTwd.toLocaleString()}`;
    document.getElementById("stat-pending").innerText = `${pendingCount} 件`;
    document.getElementById("stat-unsettled").innerText = `${unsettledCount} 筆`;
}

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

function renderRoutineTable() {
    const theadRow = document.getElementById("thead-routine-row");
    const tableBody = document.getElementById("table-body-routine");
    const range = getDashboardDateRange();
    
    let filtered = currentRecordsData.filter(d => {
        if(d.character_name !== activeChar || d.item_name !== "無") return false;
        const rd = new Date(d.date + "T00:00:00");
        return rd >= range.start && rd <= range.end;
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
                        <button class="btn btn-sm btn-outline-primary btn-edit-record action-lock" data-id="${data.id}" data-type="routine">編輯</button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-record action-lock" data-id="${data.id}">刪除</button>
                    </div>
                </td>
                `}
            </tr>
        `;
    });
    tableBody.innerHTML = html || `<tr><td colspan="${isManageMode.routine ? 3 : 3}" class="text-muted py-4">此範圍尚無紀錄</td></tr>`;

    if (isManageMode.routine) {
        const cbAll = document.getElementById("cb-all-routine");
        if(cbAll) { cbAll.addEventListener("change", (e) => { document.querySelectorAll(".cb-routine-item").forEach(cb => cb.checked = e.target.checked); }); }
    }
}

function renderLootTable() {
    const theadRow = document.getElementById("thead-loot-row");
    const tableBody = document.getElementById("table-body-loot");
    const range = getDashboardDateRange();

    let lootRecords = currentRecordsData.filter(d => {
        if(d.character_name !== activeChar || !d.item_name || d.item_name === "無") return false;
        const rd = new Date(d.date + "T00:00:00");
        return rd >= range.start && rd <= range.end;
    });
    
    lootRecords.sort((a, b) => {
        let aPending = (a.status === "待售出" || a.payout_status === "未結清") ? 1 : 0;
        let bPending = (b.status === "待售出" || b.payout_status === "未結清") ? 1 : 0;
        if(aPending !== bPending) return bPending - aPending; 
        return new Date(b.date) - new Date(a.date);
    });

    theadRow.innerHTML = `
        ${isManageMode.loot ? '<th style="width: 40px;"><input type="checkbox" id="cb-all-loot" class="form-check-input" style="cursor: pointer;"></th>' : ''}
        <th>物品與目標</th>
        ${isManageMode.listEdit ? '<th>售價與幣值</th><th>狀態修改</th>' : '<th>市價 / 實收</th><th>狀態</th>'}
        ${(isManageMode.loot || isManageMode.listEdit) ? '' : '<th>操作</th>'}
    `;

    let html = "";
    lootRecords.forEach(data => {
        let isTwd = data.currency === 'twd';
        
        // --- 快速記帳模式 (Excel Style) ---
        if (isManageMode.listEdit) {
            let priceVal = isTwd ? (data.item_total_price_twd || 0) : (data.item_total_price_billion || 0);
            html += `
                <tr class="bg-light" data-doc-id="${data.id}" data-players="${data.total_players || 1}">
                    <td class="text-start ps-md-3" style="width: 35%;">
                        <div class="fw-bold text-secondary mb-1">📦 ${data.item_name}</div>
                        <small class="text-muted">${data.date} | ${data.boss_name}</small>
                    </td>
                    <td>
                        <div class="input-group input-group-sm border-success rounded">
                            <input type="number" class="form-control list-edit-price" value="${priceVal}" step="0.1">
                            <select class="form-select text-center fw-bold list-edit-currency" style="max-width: 65px;">
                                <option value="meso" ${!isTwd ? 'selected' : ''}>億</option>
                                <option value="twd" ${isTwd ? 'selected' : ''} class="text-warning">元</option>
                            </select>
                        </div>
                    </td>
                    <td style="width: 25%;">
                        <select class="form-select form-select-sm border-success list-edit-status">
                            <option value="待售出" ${data.status === '待售出' ? 'selected' : ''}>⏳ 待售出</option>
                            <option value="已售出" ${data.status === '已售出' ? 'selected' : ''}>✔️ 已售出</option>
                            <option value="自用" ${data.status === '自用' ? 'selected' : ''}>💎 自用</option>
                        </select>
                    </td>
                </tr>
            `;
            return;
        }

        // --- 一般閱讀模式 ---
        let sBadge = data.status === "自用" ? `<span class="status-badge bg-self">💎 自用</span>` : (data.status === "待售出" ? `<span class="status-badge bg-pending">⏳ 待售出</span>` : `<span class="status-badge bg-sold">✔️ 已售出</span>`);
        let pBadge = (data.status !== "自用" && data.payout_status !== "無需分帳") ? (data.payout_status === "未結清" ? `<span class="status-badge bg-unsettled mt-1">⚠️ 未結清</span>` : `<span class="status-badge bg-settled mt-1">✔️ 已結清</span>`) : "";
        let dividendLabel = data.total_players === 1 ? "實收" : "分紅";
        let isRoutine = (userSettings.routineBosses[activeChar] || []).includes(data.boss_name);
        let badgeHtml = isRoutine ? `<span class="badge bg-dark text-warning" style="font-size: 0.6em; margin-right: 4px;">⭐</span>` : `<span class="badge bg-light text-secondary border border-secondary" style="font-size: 0.6em; margin-right: 4px;">🆕</span>`;
        let settleBtn = (data.payout_status === "未結清" && data.status !== "自用") ? `<button class="btn btn-sm btn-success btn-quick-settle mb-1 action-lock" data-id="${data.id}">✅ 結清</button>` : '';

        let priceStr = isTwd ? `${(data.item_total_price_twd || 0).toLocaleString()} 元` : `${(data.item_total_price_billion || 0).toFixed(2)} 億`;
        let divStr = data.status === '自用' ? (isTwd ? "0 元" : "0 億") : (isTwd ? `${(data.my_dividend_twd || 0).toLocaleString()} 元` : `${(data.my_dividend_billion || 0).toFixed(2)} 億`);

        html += `
            <tr>
                ${isManageMode.loot ? `<td data-label="☑️ 選取"><input type="checkbox" class="form-check-input cb-loot-item" value="${data.id}" style="cursor: pointer;"></td>` : ''}
                <td class="text-start ps-md-3" data-label="📦 掉落物">
                    <div class="fw-bold text-primary mb-1">📦 ${data.item_name}</div>
                    <small class="text-muted">${badgeHtml}${data.date} | ${data.boss_name}</small>
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
                        <button class="btn btn-sm btn-outline-primary btn-edit-record action-lock" data-id="${data.id}" data-type="loot">編輯</button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-record action-lock" data-id="${data.id}">刪除</button>
                    </div>
                </td>
                `}
            </tr>
        `;
    });
    tableBody.innerHTML = html || `<tr><td colspan="${isManageMode.listEdit ? 3 : (isManageMode.loot ? 4 : 4)}" class="text-muted py-4">目前寶物庫空空如也</td></tr>`;

    if (isManageMode.loot) {
        const cbAll = document.getElementById("cb-all-loot");
        if(cbAll) { cbAll.addEventListener("change", (e) => { document.querySelectorAll(".cb-loot-item").forEach(cb => cb.checked = e.target.checked); }); }
    }
}

function renderLuckBoard() {
    const container = document.getElementById("luck-board-container");
    if(!container) return; 
    
    const range = getDashboardDateRange();
    if(!range) {
        container.innerHTML = "<div class='text-center text-muted py-4'>請先於畫面右上角選擇有效的日期區間！</div>";
        return;
    }

    const alertBox = document.querySelector('#luckModal .alert');
    if (alertBox) {
        const startStr = getLocalDateString(range.start);
        const endStr = getLocalDateString(range.end);
        const rangeType = document.getElementById("overview-quick-range").value;
        
        if (rangeType === 'all') {
            alertBox.innerHTML = `⏱️ <strong>分析區間：全部歷史紀錄</strong> <button type="button" class="btn btn-sm btn-info py-0 px-2 ms-2 text-white" style="font-size: 0.75rem;">算法說明</button>`;
        } else {
            alertBox.innerHTML = `⏱️ <strong>分析區間：${startStr} ~ ${endStr}</strong> <button type="button" class="btn btn-sm btn-info py-0 px-2 ms-2 text-white" style="font-size: 0.75rem;">算法說明</button>`;
        }
    }

    let stats = {}; 
    let processedRuns = new Set(); 
    const myUnifiedName = "👤 本人 (全帳號總和)";
    const isMerged = document.getElementById('luck-merge-chars').checked;
    const exchangeRate = parseFloat(document.getElementById('luck-exchange-rate').value) || 6;

    currentRecordsData.forEach(record => {
        const rd = new Date(record.date + "T00:00:00");
        if (rd < range.start || rd > range.end) return;

        let participants = new Set();
        if (isMerged) {
            participants.add(myUnifiedName);
            if (record.teammates && record.teammates.length > 0) {
                record.teammates.forEach(t => {
                    if (userSettings.characters.includes(t)) participants.add(myUnifiedName);
                    else participants.add(t);
                });
            }
        } else {
            participants.add(record.character_name);
            if (record.teammates && record.teammates.length > 0) {
                record.teammates.forEach(t => participants.add(t));
            }
        }

        let pArray = Array.from(participants);
        let runKey = record.batch_id || `${record.date}_${record.boss_name}`;
        
        let hasDrop = record.item_name && record.item_name !== "無";
        let isTwd = record.currency === 'twd';
        let dropMeso = (!isTwd && hasDrop) ? (parseFloat(record.item_total_price_billion) || 0) : 0;
        let dropTwd = (isTwd && hasDrop) ? (parseFloat(record.item_total_price_twd) || 0) : 0;

        pArray.forEach(name => {
            if (!stats[name]) { stats[name] = { name: name, runs: 0, mesoValue: 0, twdValue: 0, blankRuns: 0, currentDryStreak: 0, hitDrop: false }; }

            let teamRunKey = `${name}_${runKey}`;
            if (!processedRuns.has(teamRunKey)) {
                stats[name].runs += 1;
                if (!hasDrop) { 
                    stats[name].blankRuns += 1; 
                    if (!stats[name].hitDrop) stats[name].currentDryStreak += 1;
                } else { stats[name].hitDrop = true; }
                processedRuns.add(teamRunKey);
            } else if (hasDrop) {
                if (stats[name].hitDrop === false || stats[name].blankRuns > 0) {
                    stats[name].blankRuns = Math.max(0, stats[name].blankRuns - 1);
                    if (!stats[name].hitDrop) {
                        stats[name].currentDryStreak = Math.max(0, stats[name].currentDryStreak - 1);
                        stats[name].hitDrop = true;
                    }
                }
            }

            stats[name].mesoValue += dropMeso;
            stats[name].twdValue += dropTwd;
        });
    });

    let leaderboard = Object.values(stats).map(player => {
        let equivalentMesoTotal = player.mesoValue + (player.twdValue / exchangeRate);
        return {
            ...player, equivalentMesoTotal: equivalentMesoTotal,
            luckIndex: player.runs > 0 ? (equivalentMesoTotal / player.runs) : 0,
            blankRate: player.runs > 0 ? Math.round((player.blankRuns / player.runs) * 100) : 0
        };
    });

    leaderboard.sort((a, b) => b.luckIndex - a.luckIndex);

    if(leaderboard.length === 0) { container.innerHTML = "<div class='text-center text-muted py-4'>此區間內目前沒有出團紀錄哦！</div>"; return; }

    let displayIndices = new Set();
    let N = leaderboard.length;
    if (N <= 8) {
        for(let i=0; i<N; i++) displayIndices.add(i);
    } else {
        for(let i=0; i<5; i++) displayIndices.add(i); 
        for(let i=N-3; i<N; i++) displayIndices.add(i); 
        let myIndex = leaderboard.findIndex(p => p.name === myUnifiedName || userSettings.characters.includes(p.name));
        if (myIndex !== -1) displayIndices.add(myIndex);
    }
    
    let sortedIndices = Array.from(displayIndices).sort((a, b) => a - b);
    let html = "";
    let prevIndex = -1;

    sortedIndices.forEach((actualIndex) => {
        if (prevIndex !== -1 && actualIndex - prevIndex > 1) {
            let skippedCount = actualIndex - prevIndex - 1;
            html += `<div class="text-center text-muted small my-2 py-1 bg-light rounded border" style="font-size: 0.75rem;">... 👻 中間省略 ${skippedCount} 名玩家 ...</div>`;
        }
        prevIndex = actualIndex;

        let p = leaderboard[actualIndex];
        let tierClass = "tier-b"; let titleClass = "title-b"; let titleEmoji = "✨";
        if (p.luckIndex > 1.5) { tierClass = "tier-s"; titleClass = "title-s"; titleEmoji = "👑"; } 
        else if (p.luckIndex > 0.5) { tierClass = "tier-a"; titleClass = "title-a"; titleEmoji = "🌟"; } 
        else if (p.luckIndex <= 0.1 && p.blankRate >= 70) { tierClass = "tier-f"; titleClass = "title-f"; titleEmoji = "🌚"; }

        let dryBadge = p.currentDryStreak >= 10 ? `<span class="badge bg-danger ms-1">連摃${p.currentDryStreak}</span>` : (p.currentDryStreak >= 5 ? `<span class="badge bg-warning text-dark ms-1">連摃${p.currentDryStreak}</span>` : "");
        
        let rankNum = actualIndex + 1;
        let rankDisplay = rankNum === 1 ? "🥇" : (rankNum === 2 ? "🥈" : (rankNum === 3 ? "🥉" : `<span class="text-secondary fw-bold" style="display:inline-block; width:20px; text-align:center;">${rankNum}</span>`));
        let isMe = p.name === myUnifiedName || userSettings.characters.includes(p.name);
        let displayName = isMe ? `<span class="text-primary fw-bolder">${p.name}</span>` : p.name;

        html += `
            <div class="luck-card ${tierClass} mb-2" style="padding: 0; overflow: hidden; border: 1px solid #dee2e6; border-radius: 8px;">
                <div class="d-flex justify-content-between align-items-center p-2" data-bs-toggle="collapse" data-bs-target="#luck-col-${actualIndex}" style="cursor: pointer; user-select: none;">
                    <div class="text-truncate" style="max-width: 60%; font-size: 0.9rem;">
                        ${rankDisplay} ${displayName} ${dryBadge}
                    </div>
                    <div class="d-flex align-items-center gap-2" style="font-size: 0.85rem;">
                        <span class="text-secondary">指數: <span class="text-danger fw-bold">${p.luckIndex.toFixed(2)}</span></span>
                        <span class="luck-title ${titleClass} py-0 px-2" style="font-size: 0.75rem;">${titleEmoji}</span>
                    </div>
                </div>
                
                <div class="collapse ${(actualIndex === 0 || isMe) ? 'show' : ''}" id="luck-col-${actualIndex}">
                    <div class="p-2 border-top bg-light" style="font-size: 0.85rem;">
                        <div class="row text-center mb-1">
                            <div class="col-6 border-end">
                                <div class="text-muted" style="font-size:0.75rem;">帶動楓幣</div>
                                <div class="fw-bold text-success">${p.mesoValue.toFixed(1)} 億</div>
                            </div>
                            <div class="col-6">
                                <div class="text-muted" style="font-size:0.75rem;">帶動台幣</div>
                                <div class="fw-bold currency-twd">${p.twdValue.toLocaleString()} 元</div>
                            </div>
                        </div>
                        <div class="d-flex justify-content-between px-2 mt-2 pt-1 border-top text-muted" style="font-size: 0.75rem;">
                            <span>共同出勤: ${p.runs} 場</span>
                            <span>打白工率: ${p.blankRate}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// === 設定功能與 TomSelect 表單 ===
function renderItemDatalist() {
    const datalist = document.getElementById("item-datalist"); datalist.innerHTML = "";
    const allItems = [...userSettings.customItems, ...defaultItemOptions.map(i => i.value)];
    [...new Set(allItems)].forEach(item => { datalist.innerHTML += `<option value="${item}">`; });
}

function renderCustomItemList() {
    const list = document.getElementById("custom-item-list"); list.innerHTML = ""; 
    const items = userSettings.customItems;
    if(items.length === 0) { list.innerHTML = `<li class="list-group-item text-muted text-center">目前無自訂物品</li>`; return; }
    items.forEach((item, index) => {
        const li = document.createElement("li"); li.className = "list-group-item d-flex justify-content-between align-items-center";
        li.innerHTML = `<span>${item}</span><button class="btn btn-sm btn-outline-danger" onclick="window.deleteCustomItem(${index})">刪除</button>`; list.appendChild(li);
    });
}
document.getElementById("btn-add-custom-item").addEventListener("click", () => {
    const val = document.getElementById("input-custom-item").value.trim();
    if(val && !userSettings.customItems.includes(val)) {
        userSettings.customItems.push(val); saveUserSettings();
        document.getElementById("input-custom-item").value = ""; 
        renderCustomItemList(); renderItemDatalist(); 
    }
});

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
        const globalControls = document.getElementById('global-accordion-controls');
        const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);

        if (selectedArr.length === 0) {
            container.innerHTML = ''; globalControls.classList.add('d-none'); globalControls.classList.remove('d-flex'); return;
        } else { globalControls.classList.remove('d-none'); globalControls.classList.add('d-flex'); }

        const existingCards = container.querySelectorAll('.boss-card-wrapper');
        existingCards.forEach(card => { if (!selectedArr.includes(card.getAttribute('data-boss'))) { card.remove(); } });

        selectedArr.forEach(boss => {
            if (!container.querySelector(`.boss-card-wrapper[data-boss="${boss}"]`)) {
                let lastPartySize = 1; let lastTeammates = ""; let hasTemplate = false;
                if (userSettings.bossTemplates && userSettings.bossTemplates[activeChar] && userSettings.bossTemplates[activeChar][boss]) {
                    const template = userSettings.bossTemplates[activeChar][boss];
                    lastPartySize = template.size || 1; lastTeammates = template.teammates || ""; hasTemplate = true;
                } else {
                    const lastRecord = currentRecordsData.find(r => r.character_name === activeChar && r.boss_name === boss);
                    if (lastRecord) { lastPartySize = lastRecord.total_players || 1; lastTeammates = (lastRecord.teammates || []).join(" "); }
                }

                const card = document.createElement('div'); card.className = 'card mb-2 border border-secondary shadow-sm boss-card-wrapper'; card.setAttribute('data-boss', boss);
                card.innerHTML = `
                    <div class="card-header bg-dark text-white py-2 d-flex justify-content-between align-items-center boss-card-header">
                        <span class="fw-bold mb-0"><span class="accordion-icon me-1">▶</span> 👑 ${boss}</span>
                        <span class="badge bg-secondary ms-2 opacity-75" style="font-size: 0.7em;">點擊展開/收合</span>
                    </div>
                    <div class="card-body p-2 bg-light boss-card-body d-none">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <label class="mb-0 small fw-bold text-secondary">討伐人數:</label>
                            <select class="form-select form-select-sm boss-party-size" data-boss="${boss}" style="width: 80px;">
                                <option value="1" ${lastPartySize==1?'selected':''}>1 人</option><option value="2" ${lastPartySize==2?'selected':''}>2 人</option>
                                <option value="3" ${lastPartySize==3?'selected':''}>3 人</option><option value="4" ${lastPartySize==4?'selected':''}>4 人</option>
                                <option value="5" ${lastPartySize==5?'selected':''}>5 人</option><option value="6" ${lastPartySize==6?'selected':''}>6 人</option>
                            </select>
                        </div>
                        <input type="text" class="form-control form-control-sm mb-1 boss-teammates" data-boss="${boss}" placeholder="隊友名稱 (空格隔開)" value="${lastTeammates}">
                        <div class="text-end mb-2">
                            <button type="button" class="btn btn-sm py-0 px-2 btn-save-template ${hasTemplate ? 'btn-success text-white' : 'btn-outline-info'}" data-boss="${boss}" style="font-size: 0.75em;">
                                ${hasTemplate ? '⭐ 已設為預設班底' : '📌 記憶為預設班底'}
                            </button>
                        </div>
                        <div class="boss-loot-container" data-boss="${boss}"></div>
                        <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold w-100 btn-add-loot" data-boss="${boss}">➕ 新增掉落物品</button>
                    </div>
                `;
                const header = card.querySelector('.boss-card-header'); const body = card.querySelector('.boss-card-body'); const icon = card.querySelector('.accordion-icon');
                header.addEventListener('click', () => { if (body.classList.contains('d-none')) { body.classList.remove('d-none'); icon.innerText = '▼'; } else { body.classList.add('d-none'); icon.innerText = '▶'; } });
                container.appendChild(card);
            }
        });
    });
}

document.getElementById('btn-expand-all').addEventListener('click', () => { document.querySelectorAll('.boss-card-wrapper').forEach(card => { card.querySelector('.boss-card-body').classList.remove('d-none'); card.querySelector('.accordion-icon').innerText = '▼'; }); });
document.getElementById('btn-collapse-all').addEventListener('click', () => { document.querySelectorAll('.boss-card-wrapper').forEach(card => { card.querySelector('.boss-card-body').classList.add('d-none'); card.querySelector('.accordion-icon').innerText = '▶'; }); });

function loadRoutineBosses(isManual = false) {
    if(!bossSelectMaster || document.body.classList.contains("edit-mode-active")) return;
    const routineList = userSettings.routineBosses[activeChar] || [];
    if (routineList.length === 0) { if (isManual) showToast("您尚未設定常規名單", "warning"); return; }
    
    const recordDate = document.getElementById("input-date-master").value || getLocalDateString(getTWNow());
    const monthlyBosses = ["終極黑魔法師", "困難黑魔法師"];
    let clearedBosses = new Set();
    
    currentRecordsData.forEach(d => {
        if (d.character_name !== activeChar || d.item_name !== "無") return; 
        const isMonthly = monthlyBosses.includes(d.boss_name);
        const bounds = getCycleBoundaries(recordDate, isMonthly); 
        const rd = new Date(d.date + "T00:00:00");
        if (rd >= bounds.start && rd <= bounds.end) { clearedBosses.add(d.boss_name); }
    });

    const pendingBosses = routineList.filter(boss => !clearedBosses.has(boss));
    if (routineList.length > 0 && pendingBosses.length === 0) { if (isManual) showToast("🎉 本週期常規已全數完成！", "success"); bossSelectMaster.clear(true); return; }
    bossSelectMaster.setValue(pendingBosses);
}
document.getElementById("btn-load-routine-quick").addEventListener("click", (e) => { e.preventDefault(); loadRoutineBosses(true); });

// 常規與批次 Modal 設定
function renderBossCheckboxes(containerId, checkboxClass, checkedList) {
    const container = document.getElementById(containerId); container.innerHTML = "";
    const optgroups = document.getElementById("hidden-boss-options").querySelectorAll("optgroup");
    optgroups.forEach(group => {
        let groupDiv = document.createElement("div"); groupDiv.className = "mb-3 card p-3 shadow-sm border-0";
        groupDiv.innerHTML = `<h6 class="fw-bold text-primary border-bottom pb-2 mb-2">⚔️ ${group.getAttribute("label")}</h6>`;
        let rowDiv = document.createElement("div"); rowDiv.className = "row";
        group.querySelectorAll("option").forEach(opt => {
            let isChecked = checkedList.includes(opt.value) ? "checked" : "";
            let col = document.createElement("div"); col.className = "col-12 col-md-6 mb-1";
            col.innerHTML = `
                <div class="form-check">
                    <input class="form-check-input ${checkboxClass}" type="checkbox" value="${opt.value}" id="${containerId}_${opt.value}" ${isChecked} style="cursor: pointer;">
                    <label class="form-check-label ${checkboxClass}-label" for="${containerId}_${opt.value}">${opt.innerText}</label>
                </div>
            `;
            rowDiv.appendChild(col);
        });
        groupDiv.appendChild(rowDiv); container.appendChild(groupDiv);
    });
}

document.getElementById("btn-manage-routine").addEventListener("click", () => { renderBossCheckboxes("routine-checkbox-container", "routine-checkbox", userSettings.routineBosses[activeChar] || []); });
document.getElementById("btn-routine-toggle-all").addEventListener("click", () => { const cb = document.querySelectorAll(".routine-checkbox"); const allChecked = Array.from(cb).every(c => c.checked); cb.forEach(c => c.checked = !allChecked); });
document.getElementById("btn-save-routine-modal").addEventListener("click", async () => {
    let selected = []; document.querySelectorAll(".routine-checkbox:checked").forEach(chk => { selected.push(chk.value); });
    userSettings.routineBosses[activeChar] = selected;
    try { await saveUserSettings(); bootstrap.Modal.getInstance(document.getElementById('routineModal'))?.hide(); initMasterSelect(); loadRoutineBosses(false); renderRoutineTable(); renderLootTable(); } catch(e) { showToast("儲存失敗！", "danger"); }
});

document.getElementById("batchModal").addEventListener("show.bs.modal", () => { let currentSelected = bossSelectMaster.getValue(); renderBossCheckboxes("batch-checkbox-container", "batch-checkbox", Array.isArray(currentSelected) ? currentSelected : (currentSelected ? [currentSelected] : [])); });
document.getElementById("btn-batch-toggle-all").addEventListener("click", () => { const cb = document.querySelectorAll(".batch-checkbox"); const allChecked = Array.from(cb).every(c => c.checked); cb.forEach(c => c.checked = !allChecked); });
document.getElementById("btn-confirm-batch-modal").addEventListener("click", () => {
    let selected = []; document.querySelectorAll(".batch-checkbox:checked").forEach(chk => { selected.push(chk.value); });
    bossSelectMaster.setValue(selected); bootstrap.Modal.getInstance(document.getElementById('batchModal'))?.hide();
});

function renderWeeklyTasks() {
    const container = document.getElementById("weekly-tasks-container"); container.innerHTML = "";
    if(!activeChar) return;
    const thisWeekStart = getWeekBoundaries().thisWeekStart.getTime();
    if(!userSettings.weeklyTasks[activeChar] || userSettings.weeklyTasks[activeChar].weekStart !== thisWeekStart) { userSettings.weeklyTasks[activeChar] = { weekStart: thisWeekStart, tasks: {} }; saveUserSettings(); }
    ["地下水道", "公會城簽到", "跳棋任務", "每週怪物公園", "高山副本", "安格洛公司"].forEach((task, idx) => {
        const isChecked = userSettings.weeklyTasks[activeChar].tasks[idx] ? "checked" : "";
        const div = document.createElement("div"); div.className = "form-check mb-2";
        div.innerHTML = `<input class="form-check-input task-checkbox" type="checkbox" id="task-${idx}" data-idx="${idx}" ${isChecked}> <label class="form-check-label task-checkbox-label" for="task-${idx}">${task}</label>`;
        container.appendChild(div);
    });
    document.querySelectorAll(".task-checkbox").forEach(chk => { chk.addEventListener("change", (e) => { userSettings.weeklyTasks[activeChar].tasks[e.target.dataset.idx] = e.target.checked; saveUserSettings(); }); });
}

// === 大表單儲存與編輯邏輯 ===
document.getElementById("btn-start-journey").addEventListener("click", async () => {
    const input = document.getElementById("input-first-char"); const charName = input.value.trim();
    if (!charName) { showToast("請輸入角色名稱", "warning"); return; }
    userSettings.characters = [charName]; userSettings.lastActiveChar = charName; activeChar = charName;
    await saveUserSettings(); initDashboard();
});
document.getElementById("input-first-char").addEventListener("keypress", (e) => { if (e.key === "Enter") document.getElementById("btn-start-journey").click(); });

document.getElementById('dynamic-boss-configs').addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-save-template')) {
        const btn = e.target; const bossName = btn.getAttribute('data-boss');
        const size = parseInt(document.querySelector(`.boss-party-size[data-boss="${bossName}"]`).value) || 1;
        const teammates = document.querySelector(`.boss-teammates[data-boss="${bossName}"]`).value.trim();
        if(!userSettings.bossTemplates) userSettings.bossTemplates = {}; if(!userSettings.bossTemplates[activeChar]) userSettings.bossTemplates[activeChar] = {};
        userSettings.bossTemplates[activeChar][bossName] = { size, teammates };
        saveUserSettings().then(() => { btn.innerText = "✅ 儲存成功！"; btn.classList.remove("btn-outline-info"); btn.classList.add("btn-success", "text-white"); setTimeout(() => { btn.innerText = "⭐ 已設為預設班底"; }, 1500); });
        return;
    }
    if (e.target.classList.contains('btn-add-loot')) {
        const bossName = e.target.getAttribute('data-boss'); const lootContainer = document.querySelector(`.boss-loot-container[data-boss="${bossName}"]`);
        const row = document.createElement('div'); row.className = 'row g-1 align-items-center mb-2 border-start border-warning border-3 ps-2';
        row.innerHTML = `
            <div class="col-4"><input type="text" list="item-datalist" class="form-control form-control-sm loot-name" placeholder="物品名稱"></div>
            <div class="col-4 d-flex pe-0"><input type="number" class="form-control form-control-sm loot-price" placeholder="價格" step="0.1" style="border-radius:4px 0 0 4px;"><select class="form-select form-select-sm loot-currency px-1 text-center fw-bold" style="border-radius:0 4px 4px 0; width: 55px;"><option value="meso">億</option><option value="twd" class="text-warning">元</option></select></div>
            <div class="col-3"><select class="form-select form-select-sm loot-status"><option value="待售出">待售出</option><option value="自用">自用</option></select></div>
            <div class="col-1 text-center ps-0"><button type="button" class="btn btn-sm btn-danger btn-remove-loot px-1">✖</button></div>
        `;
        lootContainer.appendChild(row);
    }
    if (e.target.classList.contains('btn-remove-loot')) { e.target.closest('.row').remove(); }
});

const saveBtnMaster = document.getElementById("btn-save-master");
const cancelEditMasterBtn = document.getElementById("btn-cancel-edit-master");

saveBtnMaster.addEventListener("click", async () => {
    const recordDate = document.getElementById("input-date-master").value;
    const selectedBosses = bossSelectMaster.getValue();
    const editId = document.getElementById("edit-doc-id-master").value;
    const editType = document.getElementById("edit-type-master").value;
    let bossesArray = Array.isArray(selectedBosses) ? selectedBosses : (selectedBosses ? [selectedBosses] : []);
    if (bossesArray.length === 0) { showToast("請至少選擇一隻討伐目標！", "warning"); return; }
    
    saveBtnMaster.innerText = "處理中..."; saveBtnMaster.disabled = true;
    let promises = []; let skippedBosses = []; const batchId = Date.now().toString();

    try {
        if (editId) {
            const boss = bossesArray[0]; 
            const partySize = parseInt(document.querySelector(`.boss-party-size[data-boss="${boss}"]`).value) || 1;
            const teammatesStr = document.querySelector(`.boss-teammates[data-boss="${boss}"]`).value.trim();
            const teamArray = teammatesStr ? teammatesStr.split(/[\s,，、]+/).filter(Boolean) : [];
            const originalEditedDoc = currentRecordsData.find(d => d.id === editId);
            const originalDate = originalEditedDoc ? originalEditedDoc.date : recordDate;
            const runRecords = currentRecordsData.filter(d => d.character_name === activeChar && d.boss_name === boss && d.date === originalDate && (d.batch_id === originalEditedDoc?.batch_id || !d.batch_id));
            
            runRecords.forEach(runDoc => {
                let updateData = { date: recordDate, total_players: partySize, teammates: teamArray };
                if (runDoc.item_name === "無") { updateData.crystal_income_billion = parseFloat(((bossCrystalPrices[boss] || 0) / partySize).toFixed(2)); } 
                else {
                    let currency = runDoc.currency || 'meso'; let priceMeso = runDoc.item_total_price_billion || 0; let priceTwd = runDoc.item_total_price_twd || 0; let status = runDoc.status; let payout = runDoc.payout_status;
                    if (runDoc.id === editId && editType === "loot") {
                        const row = document.querySelector(`.boss-loot-container[data-boss="${boss}"] .row[data-doc-id="${editId}"]`);
                        if (row) {
                            updateData.item_name = row.querySelector('.loot-name').value.trim(); currency = row.querySelector('.loot-currency').value;
                            let rawPrice = parseFloat(row.querySelector('.loot-price').value) || 0; priceMeso = currency === 'meso' ? rawPrice : 0; priceTwd = currency === 'twd' ? rawPrice : 0;
                            status = row.querySelector('.loot-status').value; payout = status === "自用" ? "無需分帳" : "未結清";
                            updateData.currency = currency; updateData.item_total_price_billion = priceMeso; updateData.item_total_price_twd = priceTwd; updateData.status = status; updateData.payout_status = payout;
                        }
                    }
                    updateData.my_dividend_billion = status === "自用" ? 0 : (priceMeso > 0 ? parseFloat((partySize > 1 ? priceMeso / partySize : priceMeso).toFixed(2)) : 0);
                    updateData.my_dividend_twd = status === "自用" ? 0 : (priceTwd > 0 ? Math.floor(partySize > 1 ? priceTwd / partySize : priceTwd) : 0);
                }
                promises.push(updateDoc(doc(db, "DropRecords", runDoc.id), updateData));
            });

            const newLootRows = document.querySelectorAll(`.boss-loot-container[data-boss="${boss}"] .row:not([data-doc-id])`);
            newLootRows.forEach(row => {
                const itemName = row.querySelector('.loot-name').value.trim(); const currency = row.querySelector('.loot-currency').value; const rawPrice = parseFloat(row.querySelector('.loot-price').value) || 0; const statusVal = row.querySelector('.loot-status').value;
                if (itemName) {
                    if (!defaultItemOptions.some(d => d.value === itemName) && !userSettings.customItems.includes(itemName)) { userSettings.customItems.push(itemName); saveUserSettings(); renderItemDatalist(); }
                    let priceMeso = currency === 'meso' ? rawPrice : 0; let priceTwd = currency === 'twd' ? rawPrice : 0; let payout = statusVal === "自用" ? "無需分帳" : "未結清";
                    promises.push(addDoc(collection(db, "DropRecords"), {
                        uid: currentUserUid, character_name: activeChar, date: recordDate, boss_name: boss, teammates: teamArray, total_players: partySize, batch_id: originalEditedDoc?.batch_id || batchId, crystal_income_billion: 0, 
                        item_name: itemName, status: statusVal, payout_status: payout, currency: currency, item_total_price_billion: priceMeso, my_dividend_billion: statusVal === "自用" ? 0 : (priceMeso > 0 ? parseFloat((partySize > 1 ? priceMeso / partySize : priceMeso).toFixed(2)) : 0), item_total_price_twd: priceTwd, my_dividend_twd: statusVal === "自用" ? 0 : (priceTwd > 0 ? Math.floor(partySize > 1 ? priceTwd / partySize : priceTwd) : 0)
                    }));
                }
            });
        } else {
            const monthlyBosses = ["終極黑魔法師", "困難黑魔法師"];
            bossesArray.forEach(boss => {
                const partySize = parseInt(document.querySelector(`.boss-party-size[data-boss="${boss}"]`).value) || 1;
                const teammatesStr = document.querySelector(`.boss-teammates[data-boss="${boss}"]`) ? document.querySelector(`.boss-teammates[data-boss="${boss}"]`).value.trim() : "";
                const teamArray = teammatesStr ? teammatesStr.split(/[\s,，、]+/).filter(Boolean) : [];
                const bounds = getCycleBoundaries(recordDate, monthlyBosses.includes(boss)); 
                const hasDuplicate = currentRecordsData.some(d => d.character_name === activeChar && d.boss_name === boss && d.item_name === "無" && new Date(d.date + "T00:00:00") >= bounds.start && new Date(d.date + "T00:00:00") <= bounds.end);
                const lootRows = document.querySelectorAll(`.boss-loot-container[data-boss="${boss}"] .row`);

                if (hasDuplicate && lootRows.length === 0) { skippedBosses.push(boss); return; }
                if (!hasDuplicate) {
                    promises.push(addDoc(collection(db, "DropRecords"), { uid: currentUserUid, character_name: activeChar, batch_id: batchId, date: recordDate, boss_name: boss, teammates: teamArray, total_players: partySize, crystal_income_billion: parseFloat(((bossCrystalPrices[boss] || 0) / partySize).toFixed(2)), item_name: "無", status: "僅紀錄", payout_status: "無需分帳", currency: "meso", item_total_price_billion: 0, my_dividend_billion: 0, item_total_price_twd: 0, my_dividend_twd: 0 }));
                }

                lootRows.forEach(row => {
                    const itemName = row.querySelector('.loot-name').value.trim(); const currency = row.querySelector('.loot-currency').value; const rawPrice = parseFloat(row.querySelector('.loot-price').value) || 0; const statusVal = row.querySelector('.loot-status').value;
                    if (itemName) {
                        if (!defaultItemOptions.some(d => d.value === itemName) && !userSettings.customItems.includes(itemName)) { userSettings.customItems.push(itemName); saveUserSettings(); renderItemDatalist(); }
                        let priceMeso = currency === 'meso' ? rawPrice : 0; let priceTwd = currency === 'twd' ? rawPrice : 0;
                        promises.push(addDoc(collection(db, "DropRecords"), { uid: currentUserUid, character_name: activeChar, batch_id: batchId, date: recordDate, boss_name: boss, teammates: teamArray, total_players: partySize, crystal_income_billion: 0, item_name: itemName, status: statusVal, payout_status: statusVal === "自用" ? "無需分帳" : "未結清", currency: currency, item_total_price_billion: priceMeso, my_dividend_billion: statusVal === "自用" ? 0 : (priceMeso > 0 ? parseFloat((partySize > 1 ? priceMeso / partySize : priceMeso).toFixed(2)) : 0), item_total_price_twd: priceTwd, my_dividend_twd: statusVal === "自用" ? 0 : (priceTwd > 0 ? Math.floor(partySize > 1 ? priceTwd / partySize : priceTwd) : 0) }));
                    }
                });
            });
        }
        await Promise.all(promises);
        if (skippedBosses.length > 0) { showConfirm("防呆機制啟動", `以下目標在該週期內已存過結晶，已自動排除重複記錄！<br><span class='fw-bold'>${skippedBosses.join("、")}</span>`, [{ text: "了解", class: "btn-primary", dismiss: true }]); } 
        else { showToast("✅ 結算儲存成功！", "success"); }
        resetMasterForm();
    } catch (error) { console.error(error); showToast("資料儲存發生異常", "danger"); saveBtnMaster.innerText = editId ? "💾 更新紀錄" : "💾 批次儲存結算"; saveBtnMaster.disabled = false; } 
    finally { loadRecords(); }
});

function resetMasterForm() {
    const currentSelectedDate = document.getElementById("input-date-master").value;
    document.getElementById("form-master").reset();
    document.getElementById("edit-doc-id-master").value = ""; document.getElementById("edit-type-master").value = "";
    document.getElementById("input-date-master").value = currentSelectedDate || getLocalDateString(getTWNow());
    if (bossSelectMaster) { bossSelectMaster.clear(true); bossSelectMaster.unlock(); }
    document.getElementById("dynamic-boss-configs").innerHTML = '';
    document.getElementById("global-accordion-controls").classList.add("d-none"); document.getElementById("global-accordion-controls").classList.remove("d-flex");
    document.getElementById("form-title-master").innerHTML = "⚔️ 討伐結算中心 (待辦)"; 
    saveBtnMaster.innerText = "💾 批次儲存結算"; saveBtnMaster.classList.replace("btn-warning", "btn-primary");
    cancelEditMasterBtn.classList.add("d-none"); saveBtnMaster.disabled = false;
    document.body.classList.remove("edit-mode-active"); loadRoutineBosses(false);
}
cancelEditMasterBtn.addEventListener("click", () => resetMasterForm());

// === 表格按鈕操作 (編輯、刪除、結清、批次) ===
document.addEventListener("click", async (e) => {
    const btnSettle = e.target.closest(".btn-quick-settle");
    if (btnSettle) {
        e.preventDefault(); const docId = btnSettle.getAttribute("data-id"); btnSettle.innerText = "..."; btnSettle.disabled = true;
        try { await updateDoc(doc(db, "DropRecords", docId), { payout_status: "已結清", status: "已售出" }); loadRecords(); showToast("✅ 帳款已結清", "success"); } catch (error) { showToast("結清失敗！", "danger"); btnSettle.innerText = "✅ 結清"; btnSettle.disabled = false; }
        return;
    }

    const btnDel = e.target.closest(".btn-delete-record");
    if (btnDel) { 
        const docId = btnDel.getAttribute("data-id"); const record = currentRecordsData.find(x => x.id === docId); if (!record) return;
        let batchCount = record.batch_id ? currentRecordsData.filter(x => x.batch_id === record.batch_id).length : 1;
        if (batchCount > 1) {
            showConfirm("批次連動刪除", `<div class='text-danger mb-2'>⚠️ 此為連動紀錄 (共 ${batchCount} 筆)</div>您要連同關聯的寶物與結晶一併刪除嗎？`, [
                { text: "💥 刪除整批紀錄", class: "btn-danger", onClick: async () => { btnDel.disabled = true; const batch = writeBatch(db); currentRecordsData.filter(x => x.batch_id === record.batch_id).forEach(d => batch.delete(doc(db, "DropRecords", d.id))); await batch.commit(); showToast("✅ 紀錄已刪除", "success"); loadRecords(); } },
                { text: "🗑️ 僅刪除單筆", class: "btn-outline-danger", onClick: async () => { btnDel.disabled = true; await deleteDoc(doc(db, "DropRecords", docId)); showToast("✅ 單筆紀錄已刪除", "success"); loadRecords(); } },
                { text: "取消", class: "btn-light", dismiss: true }
            ]);
        } else {
            showConfirm("刪除紀錄", "確定要刪除這筆單一紀錄嗎？", [
                { text: "確定刪除", class: "btn-danger", onClick: async () => { btnDel.disabled = true; await deleteDoc(doc(db, "DropRecords", docId)); showToast("✅ 紀錄已刪除", "success"); loadRecords(); } },
                { text: "取消", class: "btn-light", dismiss: true }
            ]);
        }
        return; 
    }

    const btnEdit = e.target.closest(".btn-edit-record");
    if (btnEdit) {
        const docId = btnEdit.getAttribute("data-id"); const type = btnEdit.getAttribute("data-type"); const d = currentRecordsData.find(x => x.id === docId); if (!d) return;
        resetMasterForm(); document.body.classList.add("edit-mode-active");
        document.getElementById("edit-doc-id-master").value = docId; document.getElementById("edit-type-master").value = type; document.getElementById("input-date-master").value = d.date;
        bossSelectMaster.setValue([d.boss_name]); bossSelectMaster.lock(); 

        requestAnimationFrame(() => {
            const partyInput = document.querySelector(`.boss-party-size[data-boss="${d.boss_name}"]`); if(partyInput) partyInput.value = d.total_players || 1;
            const teamInput = document.querySelector(`.boss-teammates[data-boss="${d.boss_name}"]`); if(teamInput) teamInput.value = (d.teammates || []).join(" ");
            const addLootBtn = document.querySelector(`.btn-add-loot[data-boss="${d.boss_name}"]`); const cardBody = document.querySelector(`.boss-card-wrapper[data-boss="${d.boss_name}"] .boss-card-body`); const cardIcon = document.querySelector(`.boss-card-wrapper[data-boss="${d.boss_name}"] .accordion-icon`);
            if (cardBody) { cardBody.classList.remove('d-none'); if (cardIcon) cardIcon.innerText = '▼'; }
            if (type === "loot") {
                if (addLootBtn) {
                    addLootBtn.click(); const lootRows = document.querySelectorAll(`.boss-loot-container[data-boss="${d.boss_name}"] .row`); const lastRow = lootRows[lootRows.length - 1];
                    lastRow.setAttribute('data-doc-id', d.id); lastRow.querySelector('.loot-name').value = d.item_name;
                    let isTwd = d.currency === 'twd'; lastRow.querySelector('.loot-currency').value = isTwd ? 'twd' : 'meso'; lastRow.querySelector('.loot-price').value = isTwd ? (d.item_total_price_twd || "") : (d.item_total_price_billion || "");
                    lastRow.querySelector('.loot-status').value = d.status || "待售出"; lastRow.querySelector('.btn-remove-loot').style.display = "none";
                }
                new bootstrap.Tab(document.querySelector('#pills-routine-tab')).show();
            }
            document.getElementById("form-title-master").innerHTML = "✏️ 編輯模式 (更新此筆紀錄與相關聯隊伍)"; 
            saveBtnMaster.innerText = "💾 更新紀錄"; saveBtnMaster.classList.replace("btn-primary", "btn-warning"); cancelEditMasterBtn.classList.remove("d-none");
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

// 管理按鈕狀態切換
document.getElementById("btn-toggle-manage-routine").addEventListener("click", () => { isManageMode.routine = true; document.getElementById("btn-toggle-manage-routine").classList.add("d-none"); document.getElementById("manage-bar-routine").classList.remove("d-none"); renderRoutineTable(); });
document.getElementById("btn-cancel-manage-routine").addEventListener("click", () => { isManageMode.routine = false; document.getElementById("btn-toggle-manage-routine").classList.remove("d-none"); document.getElementById("manage-bar-routine").classList.add("d-none"); renderRoutineTable(); });
document.getElementById("btn-toggle-manage-loot").addEventListener("click", () => { isManageMode.loot = true; document.getElementById("btn-toggle-manage-loot").classList.add("d-none"); document.getElementById("btn-copy-line").disabled = true; document.getElementById("manage-bar-loot").classList.remove("d-none"); renderLootTable(); });
document.getElementById("btn-cancel-manage-loot").addEventListener("click", () => { isManageMode.loot = false; document.getElementById("btn-toggle-manage-loot").classList.remove("d-none"); document.getElementById("btn-copy-line").disabled = false; document.getElementById("manage-bar-loot").classList.add("d-none"); renderLootTable(); });

// === 新增功能：清單快速記帳按鈕綁定 ===
document.getElementById("btn-toggle-list-edit")?.addEventListener("click", () => {
    isManageMode.listEdit = true;
    document.getElementById("btn-toggle-list-edit").classList.add("d-none");
    document.getElementById("manage-bar-list-edit").classList.remove("d-none");
    document.querySelectorAll(".action-lock").forEach(btn => btn.disabled = true);
    renderLootTable();
});

document.getElementById("btn-cancel-list-edit")?.addEventListener("click", () => {
    isManageMode.listEdit = false;
    document.getElementById("btn-toggle-list-edit").classList.remove("d-none");
    document.getElementById("manage-bar-list-edit").classList.add("d-none");
    document.querySelectorAll(".action-lock").forEach(btn => btn.disabled = false);
    renderLootTable();
});

document.getElementById("btn-save-list-edit")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-save-list-edit");
    btn.disabled = true; btn.innerText = "儲存中...";

    try {
        const batch = writeBatch(db);
        const rows = document.querySelectorAll("#table-body-loot tr[data-doc-id]");
        
        rows.forEach(row => {
            const docId = row.getAttribute("data-doc-id");
            const partySize = parseInt(row.getAttribute("data-players")) || 1;
            
            const rawPrice = parseFloat(row.querySelector(".list-edit-price").value) || 0;
            const currency = row.querySelector(".list-edit-currency").value;
            const status = row.querySelector(".list-edit-status").value;

            let priceMeso = currency === 'meso' ? rawPrice : 0;
            let priceTwd = currency === 'twd' ? rawPrice : 0;
            let payoutStatus = status === "自用" ? "無需分帳" : (status === "已售出" ? "已結清" : "未結清");
            
            if (status === "自用") { priceMeso = 0; priceTwd = 0; }
            
            let divMeso = priceMeso > 0 ? parseFloat((priceMeso / partySize).toFixed(2)) : 0;
            let divTwd = priceTwd > 0 ? Math.floor(priceTwd / partySize) : 0;

            batch.update(doc(db, "DropRecords", docId), {
                item_total_price_billion: priceMeso,
                item_total_price_twd: priceTwd,
                currency: currency,
                status: status,
                payout_status: payoutStatus,
                my_dividend_billion: divMeso,
                my_dividend_twd: divTwd
            });
        });

        await batch.commit();
        showToast("✅ 帳務變更已全數更新！", "success");
        document.getElementById("btn-cancel-list-edit").click(); 
        loadRecords(); 

    } catch (error) {
        console.error(error);
        showToast("批次儲存失敗", "danger");
    } finally {
        btn.disabled = false; btn.innerText = "💾 儲存變更";
    }
});

document.getElementById("btn-batch-delete-routine").addEventListener("click", () => {
    const checkedBoxes = document.querySelectorAll(".cb-routine-item:checked"); if(checkedBoxes.length === 0) { showToast("請先勾選要刪除的項目！", "warning"); return; }
    showConfirm("批次刪除", `確定要刪除選取的 ${checkedBoxes.length} 筆紀錄嗎？`, [
        { text: "💥 確認刪除", class: "btn-danger", onClick: async () => { document.getElementById("btn-batch-delete-routine").disabled = true; document.getElementById("btn-batch-delete-routine").innerText = "刪除中..."; try { const batch = writeBatch(db); checkedBoxes.forEach(cb => batch.delete(doc(db, "DropRecords", cb.value))); await batch.commit(); document.getElementById("btn-cancel-manage-routine").click(); loadRecords(); showToast(`成功刪除 ${checkedBoxes.length} 筆資料`, "success"); } catch(e) { showToast("批次刪除失敗", "danger"); } finally { document.getElementById("btn-batch-delete-routine").disabled = false; document.getElementById("btn-batch-delete-routine").innerText = "刪除選取項目"; } } },
        { text: "取消", class: "btn-light", dismiss: true }
    ]);
});

document.getElementById("btn-batch-delete-loot").addEventListener("click", () => {
    const checkedBoxes = document.querySelectorAll(".cb-loot-item:checked"); if(checkedBoxes.length === 0) { showToast("請先勾選要刪除的項目！", "warning"); return; }
    showConfirm("批次刪除", `確定要刪除選取的 ${checkedBoxes.length} 筆紀錄嗎？`, [
        { text: "💥 確認刪除", class: "btn-danger", onClick: async () => { document.getElementById("btn-batch-delete-loot").disabled = true; document.getElementById("btn-batch-delete-loot").innerText = "刪除中..."; try { const batch = writeBatch(db); checkedBoxes.forEach(cb => batch.delete(doc(db, "DropRecords", cb.value))); await batch.commit(); document.getElementById("btn-cancel-manage-loot").click(); loadRecords(); showToast(`成功刪除 ${checkedBoxes.length} 筆資料`, "success"); } catch(e) { showToast("批次刪除失敗", "danger"); } finally { document.getElementById("btn-batch-delete-loot").disabled = false; document.getElementById("btn-batch-delete-loot").innerText = "刪除選取項目"; } } },
        { text: "取消", class: "btn-light", dismiss: true }
    ]);
});

document.getElementById("btn-copy-line").addEventListener("click", () => {
    let drops = currentRecordsData.filter(d => d.character_name === activeChar && d.item_name && d.item_name !== "無" && (d.status === "待售出" || d.payout_status === "未結清"));
    if(drops.length === 0){ showToast("目前沒有未結清的寶物帳務。", "warning"); return; }
    let report = `📦 ${activeChar} 未結清帳務清單 📦\n------------------------\n`;
    drops.forEach(d => {
        let isTwd = d.currency === 'twd'; let priceStr = isTwd ? `${(d.item_total_price_twd || 0).toLocaleString()}元(台幣)` : `${(d.item_total_price_billion || 0)}億`;
        let s = d.status === "待售出" ? "⏳ 待售出" : `💰 售價 ${priceStr}`;
        report += `【${d.item_name}】 (${d.boss_name})\n 👉 狀態: ${s} / 帳款: ${d.payout_status}\n`;
        if (d.teammates && d.teammates.length > 0) report += ` 👉 分錢名單: ${d.teammates.join(", ")}\n`; report += `\n`;
    });
    navigator.clipboard.writeText(report).then(() => showToast("✅ 對帳單已成功複製到剪貼簿！", "success"));
});

// ==========================================
// === 新增功能：智慧預測記事本與匯入 ===
// ==========================================
let notepadParsedData = [];

document.getElementById('aliasSettingsModal')?.addEventListener('show.bs.modal', () => {
    const select = document.getElementById("select-alias-value");
    if (select.options.length <= 1) { 
        const optionsHtml = document.getElementById("hidden-boss-options").innerHTML;
        select.innerHTML += optionsHtml;
    }
    renderAliasList();
});

function renderAliasList() {
    const container = document.getElementById("alias-list-container");
    container.innerHTML = "";
    
    const aliases = userSettings.bossAliases || {};
    const keys = Object.keys(aliases);
    
    if (keys.length === 0) {
        container.innerHTML = `<li class="list-group-item text-muted text-center py-3">目前沒有任何簡稱設定</li>`;
        return;
    }
    
    keys.forEach(key => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";
        li.innerHTML = `
            <div>
                <span class="badge bg-primary fs-6 me-2">${key}</span> 
                <span class="text-muted">➔</span> 
                <span class="fw-bold ms-2">${aliases[key]}</span>
            </div>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteAlias('${key}')">刪除</button>
        `;
        container.appendChild(li);
    });
}

document.getElementById("btn-add-alias")?.addEventListener("click", () => {
    const keyInput = document.getElementById("input-alias-key");
    const valSelect = document.getElementById("select-alias-value");
    
    const key = keyInput.value.trim();
    const val = valSelect.value;
    
    if (!key) { showToast("請輸入簡稱！", "warning"); return; }
    if (!val) { showToast("請選擇對應的官方名稱！", "warning"); return; }
    
    userSettings.bossAliases[key] = val;
    saveUserSettings().then(() => {
        showToast("✅ 簡稱對應已儲存！", "success");
        keyInput.value = "";
        valSelect.value = "";
        renderAliasList();
    });
});

window.deleteAlias = function(key) {
    if (userSettings.bossAliases[key]) {
        delete userSettings.bossAliases[key];
        saveUserSettings().then(() => {
            renderAliasList();
        });
    }
};

document.getElementById("btn-analyze-notepad")?.addEventListener("click", () => {
    const text = document.getElementById("notepad-input").value.trim();
    if (!text) return showToast("筆記本是空的哦！", "warning");

    const lines = text.split('\n');
    notepadParsedData = [];
    const currentYear = new Date().getFullYear();
    
    const allBossOptions = Array.from(document.getElementById("hidden-boss-options").querySelectorAll("option")).map(opt => opt.value);

    lines.forEach((line, index) => {
        if (!line.trim()) return;

        const parts = line.split(/[\s,]+/).filter(Boolean);
        let parsed = { id: `note_${Date.now()}_${index}`, raw: line, date: "", char: "", boss: "", item: "" };

        // 1. 抓日期
        const dateIndex = parts.findIndex(p => p.includes('/') || p.includes('-'));
        if (dateIndex !== -1) {
            let rawDate = parts.splice(dateIndex, 1)[0];
            let dParts = rawDate.split(/[-/]/);
            if (dParts.length === 2) parsed.date = `${currentYear}-${dParts[0].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
            else if (dParts.length === 3) parsed.date = `${dParts[0]}-${dParts[1].padStart(2, '0')}-${dParts[2].padStart(2, '0')}`;
        } else {
            parsed.date = document.getElementById("input-date-master").value || getLocalDateString(getTWNow()); 
        }

        // 2. 抓角色
        const charIndex = parts.findIndex(p => userSettings.characters.includes(p));
        if (charIndex !== -1) {
            parsed.char = parts.splice(charIndex, 1)[0];
        } else {
            parsed.char = activeChar; 
        }

        // 3. 抓 Boss
        let bossFound = false;
        for (let i = 0; i < parts.length; i++) {
            let p = parts[i];
            if (userSettings.bossAliases && userSettings.bossAliases[p]) {
                parsed.boss = userSettings.bossAliases[p];
                parts.splice(i, 1);
                bossFound = true; break;
            }
            const match = allBossOptions.find(b => b.includes(p));
            if (match) {
                parsed.boss = match;
                parts.splice(i, 1);
                bossFound = true; break;
            }
        }

        // 4. 剩下的文字塞給物品
        parsed.item = parts.join(" ");

        notepadParsedData.push(parsed);
    });

    renderNotepadAudit();
});

function renderNotepadAudit() {
    const tbody = document.getElementById("notepad-audit-body");
    const commitBtn = document.getElementById("btn-commit-notepad");
    const warningText = document.getElementById("audit-warning");
    
    if(!tbody) return;

    let html = "";
    let hasError = false;

    const bossOptionsHtml = document.getElementById("hidden-boss-options").innerHTML;

    notepadParsedData.forEach(data => {
        const isBossValid = data.boss !== ""; 
        const isCharValid = userSettings.characters.includes(data.char);
        
        if (!isBossValid || !isCharValid) hasError = true;

        html += `
            <tr id="tr_${data.id}">
                <td><input type="date" class="form-control form-control-sm" value="${data.date}" onchange="updateNoteData('${data.id}', 'date', this.value)"></td>
                <td>
                    <input type="text" class="form-control form-control-sm ${isCharValid ? '' : 'border-danger bg-danger-subtle'}" value="${data.char}" placeholder="角色名" onchange="updateNoteData('${data.id}', 'char', this.value)">
                </td>
                <td>
                    <select class="form-select form-select-sm ${isBossValid ? '' : 'border-danger bg-danger-subtle'}" onchange="updateNoteData('${data.id}', 'boss', this.value)">
                        <option value="">-- 手動補齊 Boss --</option>
                        ${bossOptionsHtml}
                    </select>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${data.item}" placeholder="物品/備註" onchange="updateNoteData('${data.id}', 'item', this.value)">
                </td>
                <td><button class="btn btn-sm btn-outline-danger" onclick="removeNoteRow('${data.id}')">刪除</button></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    notepadParsedData.forEach(data => {
        if (data.boss) {
            const select = document.querySelector(`#tr_${data.id} select`);
            if (select) select.value = data.boss;
        }
    });

    commitBtn.disabled = hasError || notepadParsedData.length === 0;
    if (hasError) warningText.classList.remove("d-none");
    else warningText.classList.add("d-none");
}

window.updateNoteData = function(id, field, value) {
    const record = notepadParsedData.find(d => d.id === id);
    if(record) record[field] = value;
    renderNotepadAudit(); 
};

window.removeNoteRow = function(id) {
    notepadParsedData = notepadParsedData.filter(d => d.id !== id);
    renderNotepadAudit();
};

document.getElementById("btn-commit-notepad")?.addEventListener("click", async () => {
    const hasError = notepadParsedData.some(d => !d.boss || !userSettings.characters.includes(d.char));
    if (hasError) {
        showToast("還有紅色錯誤欄位尚未修正！", "warning");
        return;
    }

    const commitBtn = document.getElementById("btn-commit-notepad");
    commitBtn.innerHTML = "寫入資料中... ⏳";
    commitBtn.disabled = true;

    try {
        const batch = writeBatch(db);
        const batchId = "import_" + Date.now().toString(); 

        notepadParsedData.forEach(row => {
            let rawItemsString = row.item.trim() || "無";
            let itemNames = rawItemsString.split(/、|,|，/).map(s => s.trim()).filter(Boolean);

            itemNames.forEach(itemName => {
                const docRef = doc(collection(db, "DropRecords"));
                let isNoDrop = (itemName === "無");
                
                batch.set(docRef, {
                    uid: currentUserUid,
                    character_name: row.char,
                    date: row.date,
                    boss_name: row.boss,
                    item_name: itemName,
                    status: isNoDrop ? "僅紀錄" : "待售出",
                    payout_status: isNoDrop ? "無需分帳" : "未結清",
                    currency: "meso",
                    item_total_price_billion: 0,
                    my_dividend_billion: 0,
                    item_total_price_twd: 0,
                    my_dividend_twd: 0,
                    teammates: [], 
                    total_players: 1,
                    batch_id: batchId,
                    crystal_income_billion: 0 
                });
            });
        });

        await batch.commit();
        showToast(`✅ 成功匯入並建立資料！`, "success");
        
        notepadParsedData = [];
        document.getElementById("notepad-input").value = "";
        renderNotepadAudit();
        
        const modalInstance = bootstrap.Modal.getInstance(document.getElementById('smartNotepadModal'));
        if (modalInstance) modalInstance.hide();
        
        loadRecords();

    } catch (error) {
        console.error("批次匯入失敗:", error);
        showToast("資料匯入發生異常，請重試", "danger");
    } finally {
        commitBtn.innerHTML = "💾 確認並寫入資料庫";
        commitBtn.disabled = false;
    }
});
