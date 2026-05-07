import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAIY9PU-bDLktkTpLSmFKRe1uepvWCKEiU",
    authDomain: "maplestoryboss.firebaseapp.com",
    projectId: "maplestoryboss",
    storageBucket: "maplestoryboss.firebasestorage.app",
    messagingSenderId: "198034430854",
    appId: "1:198034430854:web:527ffcee039e223b972a07",
    measurementId: "G-SG0DN633FC"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

export const bossCrystalPrices = { 
    "終極黑魔法師": 30.0, "終極瑪麗西亞": 15.0, "終極咖凌": 14.433, "終極最初的敵對者": 13.44, "終極監視者卡洛斯": 12.371, "終極受選的賽蓮": 7.242, "終極史烏": 3.235, 
    "困難黑魔法師": 9.908, "困難巴德利斯": 8.4, "困難林波": 7.49, "困難咖凌": 7.211, "困難最初的敵對者": 6.82, "混沌監視者卡洛斯": 6.188, "困難受選的賽蓮": 2.716, "困難真希拉": 1.452, "困難威爾": 1.274, "混沌守護天使綠水靈": 1.265, "困難頓凱爾": 1.262, "混沌戴斯克": 1.112, "困難露希妲": 1.024, "困難史烏": 0.919, "困難戴米安": 0.857, 
    "普通林波": 3.75, "普通咖凌": 3.617, "普通最初的敵對者": 3.71, "普通監視者卡洛斯": 3.09, "普通巴德利斯": 5.6, "普通瑪麗西亞": 1.5, "普通受選的賽蓮": 1.498, "普通真希拉": 1.244, "普通頓凱爾": 0.847, "普通戴斯克": 0.795, "普通守護天使綠水靈": 0.43, "普通威爾": 0.742, "普通露希妲": 0.643, "普通戴米安": 0.2884, "普通史烏": 0.272,
    "簡單咖凌": 2.583, "簡單監視者卡洛斯": 2.369, "簡單威爾": 0.574, "簡單露希妲": 0.538
};
 
export const defaultItemOptions = [
    { group: "漆黑BOSS套裝", value: "口紅控制器標誌", text: "口紅控制器標誌" }, { group: "漆黑BOSS套裝", value: "附有魔力的眼罩", text: "附有魔力的眼罩" }, { group: "漆黑BOSS套裝", value: "全面控制核心", text: "全面控制核心" }, { group: "漆黑BOSS套裝", value: "巨大的恐怖", text: "巨大的恐怖" }, { group: "漆黑BOSS套裝", value: "苦痛的根源", text: "苦痛的根源" }, { group: "漆黑BOSS套裝", value: "創世的胸章", text: "創世的胸章" }, { group: "漆黑BOSS套裝", value: "夢幻的腰帶", text: "夢幻的腰帶" }, { group: "漆黑BOSS套裝", value: "米特拉的憤怒選擇箱", text: "米特拉的憤怒選擇箱" }, { group: "漆黑BOSS套裝", value: "指揮官力量耳環", text: "指揮官力量耳環" }, { group: "漆黑BOSS套裝", value: "受詛咒的魔導書選擇箱", text: "受詛咒的魔導書選擇箱" },
    { group: "黎明的BOSS套組", value: "守護者天使戒指", text: "守護者天使戒指" }, { group: "黎明的BOSS套組", value: "破曉墜飾", text: "破曉墜飾" }, { group: "黎明的BOSS套組", value: "暮光印記", text: "暮光印記" }, { group: "黎明的BOSS套組", value: "星耀耳環", text: "星耀耳環" },
    { group: "光輝BOSS套裝", value: "根源的耳語", text: "根源的耳語" }, { group: "光輝BOSS套裝", value: "死亡之誓", text: "死亡之誓" }, 
    { group: "其他", value: "永續戒指Lv.4", text: "永續戒指Lv.4" }, { group: "其他", value: "規範戒指Lv.4", text: "規範戒指Lv.4" },{ group: "其他", value: "武器泡泡Lv.4", text: "武器泡泡Lv.4" },{ group: "其他", value: "月之淚", text: "月之淚" },{ group: "其他", value: "瑪麗西亞靈魂寶珠", text: "瑪麗西亞靈魂寶珠" },{ group: "其他", value: "卓越鐵鎚(腰帶)", text: "卓越鐵鎚(腰帶)" },{ group: "其他", value: "卓越鐵鎚(臉部裝飾)", text: "卓越鐵鎚(臉部裝飾)" },{ group: "其他", value: "卓越鐵鎚(眼飾)", text: "卓越鐵鎚(眼飾)" },{ group: "其他", value: "卓越鐵鎚(勳章)", text: "卓越鐵鎚(勳章)" },{ group: "其他", value: "卓越鐵鎚(耳環)", text: "卓越鐵鎚(耳環)" },{ group: "其他", value: "信念的研磨石", text: "信念的研磨石" }, { group: "其他", value: "生命的研磨石", text: "生命的研磨石" }
];
