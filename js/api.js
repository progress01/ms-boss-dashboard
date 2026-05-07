import { db } from './config.js';
import { collection, query, where, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let cachedUserSettings = null;

export async function fetchUserSettings(uid) {
    if (!cachedUserSettings) {
        const docSnap = await getDoc(doc(db, "UserSettings", uid));
        if (docSnap.exists()) {
            cachedUserSettings = docSnap.data();
        }
    }
    return cachedUserSettings;
}

export async function saveUserSettingsToDB(uid, settings) {
    cachedUserSettings = settings;
    await setDoc(doc(db, "UserSettings", uid), settings);
}

export async function fetchRecordsByDateRange(uid, startDateStr, endDateStr) {
    if (!uid) return [];
    try {
        const q = query(
            collection(db, "DropRecords"),
            where("uid", "==", uid),
            where("date", ">=", startDateStr),
            where("date", "<=", endDateStr)
        );

        const querySnapshot = await getDocs(q);
        let records = [];
        querySnapshot.forEach((doc) => {
            records.push({ id: doc.id, ...doc.data() });
        });

        return records.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
        console.error("資料讀取失敗，請確認是否已建立複合索引:", error);
        throw error;
    }
}
