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

// === 視圖與初始化 ===
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
    document.getElementById("dashboard-title").innerText = activeChar; 
    document.getElementById("mobile-active-char").innerText = `⚔️ ${activeChar}`; 
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
        
        // 為了避免過於複雜，這裡先簡單渲染帳號總覽，確保資料有進來
        let accountCrystal = 0;
        currentRecordsData.forEach(data => {
            const rd = new Date(data.date + "T00:00:00");
            if (rd >= uiRange.start && rd <= uiRange.end) {
                accountCrystal += data.crystal_income_billion || 0;
            }
        });
        document.getElementById("account-total-crystal").innerText = accountCrystal.toFixed(2) + " 億";

    } catch (error) { 
        showToast("無法連線至資料庫，請確認索引已建立", "danger"); 
    }
}

// === 核心身份驗證監聽 (解決按鈕死當的關鍵) ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserUid = user.uid; 
        document.getElementById("user-name").innerText = user.displayName;
        document.getElementById("input-date-master").value = getLocalDateString(getTWNow()); 
        await loadUserSettings();
    } else {
        currentUserUid = null; showScreen('login'); 
    }
});

// 🚀 這是你一開始卡住的關鍵：登入與登出按鈕事件
document.getElementById("btn-login").addEventListener("click", () => { 
    signInWithPopup(auth, provider).catch(error => { 
        console.error("登入失敗:", error); 
        showToast("登入失敗！請確認瀏覽器沒阻擋彈出視窗。", "danger"); 
    }); 
});

document.getElementById("btn-logout").addEventListener("click", (e) => { 
    e.preventDefault(); 
    showConfirm("登出", "您確定要登出嗎？", [
        { text: "🚪 確定登出", class: "btn-danger", onClick: () => signOut(auth) },
        { text: "取消", class: "btn-light", dismiss: true }
    ]);
});

document.getElementById("overview-quick-range").addEventListener("change", loadRecords);
document.getElementById("overview-start-date").addEventListener("change", loadRecords);
document.getElementById("overview-end-date").addEventListener("change", loadRecords);
