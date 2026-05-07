// js/app.js
import { db, auth, provider, bossCrystalPrices, defaultItemOptions } from './config.js';
import { fetchUserSettings, saveUserSettingsToDB, fetchRecordsByDateRange } from './api.js';
import { collection, addDoc, query, where, getDocs, doc, deleteDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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

// === 全域掛載 UI 共用函式 ===
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

// === 核心資料與流程控制 ===
const loginScreen = document.getElementById("login-screen");
const onboardingScreen = document.getElementById("onboarding-screen");
const mainApp = document.getElementById("main-app");

function showScreen(screen) {
    loginScreen.style.display = "none"; onboardingScreen.style.display = "none"; mainApp.style.display = "none";
    if (screen === 'login') loginScreen.style.display = "flex";
    if (screen === 'onboarding') onboardingScreen.style.display = "flex";
    if (screen === 'dashboard') mainApp.style.display = "block";
}

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
    try { await saveUserSettingsToDB(currentUserUid, userSettings); } 
    catch(err) { console.error("設定儲存失敗", err); }
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

// 🚀 核心改造：動態決定載入區間，兼顧 Heatmap 需求
async function loadRecords() {
    if(!currentUserUid) return;
    try {
        const uiRange = getDashboardDateRange();
        if (!uiRange) return;

        // 計算 Heatmap 所需的最低日期 (往前推 16 週)
        const today = getTWNow();
        const heatmapStart = new Date(today);
        heatmapStart.setDate(today.getDate() - (16 * 7) - today.getDay());
        
        // 判斷要抓的範圍 (取 UI選擇日期 與 Heatmap所需日期 的最大聯集)
        let fetchStart = uiRange.start < heatmapStart ? uiRange.start : heatmapStart;
        let fetchEnd = uiRange.end > today ? uiRange.end : today;

        const startStr = getLocalDateString(fetchStart);
        const endStr = getLocalDateString(fetchEnd);

        // 呼叫優化後的 API
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

// 監聽日期選單切換，觸發重新讀取資料
document.getElementById("overview-quick-range").addEventListener("change", loadRecords);
document.getElementById("overview-start-date").addEventListener("change", loadRecords);
document.getElementById("overview-end-date").addEventListener("change", loadRecords);

// === 以下為其餘 DOM 操作與事件監聽 (保留原始邏輯，請將你原本程式碼下半段所有的 render 函式與 EventListeners 貼在此處) ===

document.addEventListener("DOMContentLoaded", () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
});

// ... (如 renderHeatmap, updateAccountOverview, initMasterSelect, eventListeners 等，由於這些與架構拆分無關，直接沿用你原有的邏輯貼在此處即可) ...
