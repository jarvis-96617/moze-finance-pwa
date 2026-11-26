import { getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const app = getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const PRESET_COMBOS_KEY = "mozePresetCombosV1";
const LAST_CAT_ACC_KEY = "mozeLastCatAccV1";

let calcExpr = "";
let currentType = "支出";
let selectedMainCat = "";
let selectedSubCat = "";
let tierLevel = 1; // 1: 數字鍵盤, 2: 主/子類別格子, 3: 帳戶/專案/標籤
let presets = [
  { label: "早餐 55", type: "支出", amount: 55, mainCat: "飲食", subCat: "早餐", account: "現金", name: "早餐" },
  { label: "午餐 120", type: "支出", amount: 120, mainCat: "飲食", subCat: "午餐", account: "現金", name: "午餐" },
  { label: "微糖純茶 45", type: "支出", amount: 45, mainCat: "飲食", subCat: "飲料/點心", account: "現金", name: "微糖純茶" }
];
let lastCatAccMap = {};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function loadLocalMeta() {
  try {
    const p = JSON.parse(localStorage.getItem(PRESET_COMBOS_KEY) || "null");
    if (Array.isArray(p) && p.length) presets = p;
  } catch (e) {}
  try {
    const m = JSON.parse(localStorage.getItem(LAST_CAT_ACC_KEY) || "{}");
    if (m && typeof m === "object") lastCatAccMap = m;
  } catch (e) {}
}

function saveLocalMeta() {
  try { localStorage.setItem(PRESET_COMBOS_KEY, JSON.stringify(presets)); } catch (e) {}
  try { localStorage.setItem(LAST_CAT_ACC_KEY, JSON.stringify(lastCatAccMap)); } catch (e) {}
}

// =========================================================================
// 1. 毛玻璃與滑動指示器視覺強化
// =========================================================================
function injectEnhancedStyles() {
  if (document.getElementById("qe-enhanced-style")) return;
  const style = document.createElement("style");
  style.id = "qe-enhanced-style";
  style.textContent = `
    .glass-card {
      transition: transform .22s cubic-bezier(.2,.9,.25,1), box-shadow .25s ease;
    }
    .glass-card:hover {
      box-shadow: inset 0 1px 0 var(--card-hi), 0 12px 32px rgba(0,0,0,.14);
    }
    .nav-indicator {
      position: relative;
    }
    .nav-indicator::after {
      content: "";
      position: absolute;
      bottom: 2px;
      width: 16px;
      height: 3px;
      border-radius: 999px;
      background: var(--accent);
      opacity: 0;
      transform: scaleX(0.4);
      transition: opacity .22s ease, transform .22s ease;
    }
    .nav-btn.text-cyan-400 .nav-indicator::after {
      opacity: 1;
      transform: scaleX(1);
    }
    #qe-fab {
      position: fixed;
      right: 18px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
      z-index: 42;
      width: 54px;
      height: 54px;
      border-radius: 999px;
      background: var(--btn-grad);
      color: #fff;
      box-shadow: var(--btn-shadow), 0 10px 24px rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.35);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .18s ease, box-shadow .2s ease;
    }
    @media (min-width: 1024px) {
      #qe-fab { bottom: 26px; right: 28px; }
    }
    #qe-fab:active { transform: scale(.92); }
    .qe-sheet {
      background-color: var(--glass-strong);
      -webkit-backdrop-filter: blur(42px) saturate(180%);
      backdrop-filter: blur(42px) saturate(180%);
      border: 1px solid var(--card-border);
      border-radius: 1.85rem 1.85rem 0 0;
      animation: qeUp .28s cubic-bezier(.2,.9,.25,1);
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
    }
    @media (min-width: 640px) { .qe-sheet { border-radius: 1.85rem; } }
    @keyframes qeUp { from { transform: translateY(36px); opacity: 0; } to { transform: none; opacity: 1; } }
    .swipe-row-wrap {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
    }
    .swipe-row-content {
      position: relative;
      z-index: 2;
      background: transparent;
      transition: transform .2s ease;
      touch-action: pan-y;
    }
    .swipe-action-bg {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      font-size: 11px;
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);
}

// =========================================================================
// 2. 流水連動餘額計算與明細左右滑動渲染
// =========================================================================
function parseYmKeyFromLabel(monthStr) {
  const parts = String(monthStr || "").split("/");
  if (parts.length < 2) return "";
  let y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(y) || isNaN(m)) return "";
  if (y < 1911) y += 1911;
  return `${y}/${String(m).padStart(2, "0")}`;
}

function parseYmKeyFromDateStr(dateStr) {
  const parts = String(dateStr || "").replace(/-/g, "/").split("/");
  if (parts.length < 2) return "";
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(y) || isNaN(m)) return "";
  return `${y}/${String(m).padStart(2, "0")}`;
}

function txToTimestamp(tx) {
  if (typeof tx.ts === "number" && !isNaN(tx.ts)) return tx.ts;
  const dStr = `${String(tx.date || "").replace(/-/g, "/")} ${tx.time || "00:00"}`;
  const parsed = Date.parse(dStr);
  return isNaN(parsed) ? 0 : parsed;
}

// 計算指定月份各帳戶「月初快照 + 當月流水」即時餘額
function computeLiveAccountBalances(state, mIdx, monthStr) {
  const targetYm = parseYmKeyFromLabel(monthStr);
  const accounts = state.globalData?.assets?.accounts || [];
  const baseMap = {};
  accounts.forEach(a => {
    baseMap[a.name] = Number(a.values?.[mIdx] || 0);
  });

  const myEmail = (state.currentUser?.email || "").toLowerCase();

  // 個人流水（當月）
  const monthPersonal = (state.personalTx || []).filter(t => parseYmKeyFromDateStr(t.date) === targetYm);
  // 共同帳本流水（當月，僅計入自己付款的交易）
  const monthSharedMyPaid = (state.sharedTx || []).filter(t =>
    parseYmKeyFromDateStr(t.date) === targetYm &&
    (t.payerEmail || "").toLowerCase() === myEmail
  );

  const applyDelta = (tx) => {
    if (!tx || tx.type === "餘額調整") return;
    const amt = Math.abs(Number(tx.amount || 0));
    const fee = Math.abs(Number(tx.fee || 0));
    const disc = Math.abs(Number(tx.discount || 0));
    const netOut = Math.max(0, amt - disc) + fee;
    const netIn = Math.max(0, amt - disc);

    if (tx.type === "轉帳") {
      if (tx.account && baseMap[tx.account] !== undefined) baseMap[tx.account] -= netOut;
      if (tx.toAccount && baseMap[tx.toAccount] !== undefined) baseMap[tx.toAccount] += netIn;
      return;
    }
    if (tx.type === "轉出") {
      if (tx.account && baseMap[tx.account] !== undefined) baseMap[tx.account] -= netOut;
      return;
    }
    if (tx.type === "轉入") {
      if (tx.account && baseMap[tx.account] !== undefined) baseMap[tx.account] += netIn;
      return;
    }
    if (!tx.account || baseMap[tx.account] === undefined) return;

    const isCard = (tx.account.includes("卡") || tx.account.includes("信用卡"));
    if (tx.type === "支出" || tx.type === "應付款項") {
      // 信用卡負債以負數呈現時，支出使餘額更負；一般帳戶扣款
      baseMap[tx.account] += isCard ? -netOut : -netOut;
    } else if (tx.type === "收入" || tx.type === "退款" || tx.type === "應收款項") {
      baseMap[tx.account] += netIn;
    }
  };

  monthPersonal.forEach(applyDelta);
  monthSharedMyPaid.forEach(applyDelta);

  return baseMap;
}

// 覆寫明細渲染：排除轉帳收支膨脹、安全跳脫 HTML、支援左滑刪除與右滑編輯
function patchLedgerAndBalances() {
  const state = window.__FINANCE_APP__.getState();
  const selMonth = document.getElementById("select-month");
  if (!selMonth || !state.globalData) return;

  const mIdx = parseInt(selMonth.value || "0", 10);
  const monthStr = selMonth.options[selMonth.selectedIndex]?.text || "";
  const targetYm = parseYmKeyFromLabel(monthStr);

  // 1. 修正收支統計（排除轉帳、轉出、轉入、餘額調整）
  const isShared = state.activeBookId !== "personal";
  const sourceList = (isShared ? state.sharedTx : state.personalTx)
    .slice()
    .sort((a, b) => txToTimestamp(b) - txToTimestamp(a));

  const typeFilter = document.getElementById("filter-tx-type")?.value || "ALL";
  let filtered = sourceList.filter(tx => {
    if (typeFilter !== "ALL" && tx.type !== typeFilter) return false;
    if (!targetYm) return true;
    return parseYmKeyFromDateStr(tx.date) === targetYm;
  });
  if (!filtered.length && sourceList.length && typeFilter === "ALL") {
    filtered = sourceList.slice(0, 30);
  }

  let expSum = 0, incSum = 0;
  filtered.forEach(tx => {
    const amt = Math.abs(Number(tx.amount || 0));
    if (tx.type === "支出" || tx.type === "應付款項") expSum += amt;
    if (tx.type === "收入" || tx.type === "退款") incSum += amt;
  });
  const sumEl = document.getElementById("txt-month-summary");
  if (sumEl) {
    sumEl.textContent = `支出 NT$ ${Math.round(expSum).toLocaleString()} · 收入 NT$ ${Math.round(incSum).toLocaleString()}`;
  }
  const cntEl = document.getElementById("txt-tx-count");
  if (cntEl) cntEl.textContent = `${filtered.length} 筆`;

  // 2. 重繪明細列（左滑刪除 / 右滑編輯 + 安全 esc）
  const listEl = document.getElementById("tx-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">尚無記帳紀錄，點選右下角「＋」快速記帳。</div>`;
    } else {
      filtered.forEach(tx => {
        const isOut = (tx.type === "支出" || tx.type === "轉出" || tx.type === "應付款項");
        const isXfer = (tx.type === "轉帳" || tx.type === "轉出" || tx.type === "轉入");
        const sign = isXfer ? "" : (isOut ? "-" : "+");
        const colorCls = isXfer ? "text-cyan-400" : (isOut ? "text-rose-400" : "text-emerald-400");

        const wrap = document.createElement("div");
        wrap.className = "swipe-row-wrap my-1";
        wrap.innerHTML = `
          <div class="swipe-action-bg">
            <span class="text-cyan-400">右滑編輯</span>
            <span class="text-rose-400">左滑刪除</span>
          </div>
          <div class="swipe-row-content p-2 rounded-xl bg-slate-800/45 flex justify-between items-center gap-2 text-xs">
            <div class="min-w-0">
              <div class="font-bold truncate">${esc(tx.name || tx.subCat || tx.mainCat || tx.type)} <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">${esc(tx.mainCat || "")}${tx.subCat ? "·" + esc(tx.subCat) : ""}</span></div>
              <div class="text-[10px] text-slate-400 truncate">${esc(tx.date || "")} ${esc(tx.time || "")} · ${esc(tx.account || "")}${tx.toAccount ? " → " + esc(tx.toAccount) : ""}${tx.project ? " · #" + esc(tx.project) : ""}${isShared && tx.payerLabel ? " · 付:" + esc(tx.payerLabel) : ""}</div>
            </div>
            <div class="font-extrabold shrink-0 ${colorCls}">${sign}${esc(tx.currency || "TWD")} ${Math.abs(Number(tx.amount || 0)).toLocaleString()}</div>
          </div>`;

        const content = wrap.querySelector(".swipe-row-content");
        let startX = 0, curDx = 0;
        content.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; curDx = 0; }, { passive: true });
        content.addEventListener("touchmove", (e) => {
          curDx = e.touches[0].clientX - startX;
          if (Math.abs(curDx) > 8) content.style.transform = `translateX(${Math.max(-80, Math.min(80, curDx))}px)`;
        }, { passive: true });
        content.addEventListener("touchend", async () => {
          content.style.transform = "";
          if (curDx < -55) {
            // 左滑刪除
            const uid = auth.currentUser.uid;
            if (isShared) await deleteDoc(doc(db, "sharedBooks", state.activeBookId, "transactions", tx.id));
            else await deleteDoc(doc(db, "users", uid, "transactions", tx.id));
            await window.__FINANCE_APP__.reloadAll();
            window.showToast("已左滑刪除紀錄");
          } else if (curDx > 55) {
            // 右滑編輯
            openQuickSheet(tx);
          }
          curDx = 0;
        });
        content.addEventListener("dblclick", () => openQuickSheet(tx));
        listEl.appendChild(wrap);
      });
    }
  }

  // 3. 同步更新「資產總覽」與「卡費補水」為即時餘額（月初快照 + 當月流水）
  const liveMap = computeLiveAccountBalances(state, mIdx, monthStr);
  const fxRates = state.forexRates || { JPY: 0.21, KRW: 0.024, USD: 32.2 };
  const getFx = (name = "") => {
    if (name.includes("日幣") || name.includes("JPY")) return { cur: "JPY", sym: "¥", rate: fxRates.JPY };
    if (name.includes("韓幣") || name.includes("韓元") || name.includes("KRW")) return { cur: "KRW", sym: "₩", rate: fxRates.KRW };
    if (name.includes("美金") || name.includes("美元") || name.includes("USD")) return { cur: "USD", sym: "US$", rate: fxRates.USD };
    return { cur: "TWD", sym: "NT$", rate: 1 };
  };

  let nonSec = 0, secMkt = 0;
  const cats = {};
  const assetsEl = document.getElementById("assets-list");
  if (assetsEl) {
    assetsEl.innerHTML = "";
    (state.globalData?.assets?.accounts || []).forEach(acc => {
      if ((state.hiddenAccounts || []).includes(acc.name)) return;
      if (["股票代號", "股票名", "現值"].includes(acc.name) || acc.name.includes(".TW")) return;
      const val = liveMap[acc.name] !== undefined ? liveMap[acc.name] : Number(acc.values?.[mIdx] || 0);
      const fx = getFx(acc.name);
      const twdVal = val * fx.rate;
      const isSec = (acc.category === "證券" || acc.name.includes("證券") || acc.name.includes("借券"));
      const isSpecial = (acc.name === "國泰嚕哪基金" || acc.name === "彰化銀行(房貸)");
      if (isSec) secMkt += twdVal;
      else if (!isSpecial) nonSec += twdVal;
      if (!cats[acc.category]) cats[acc.category] = [];
      cats[acc.category].push({ ...acc, val, fx, twdVal });
    });

    const s = state.globalData?.salary || {};
    const port = state.portfolioByMonth?.[monthStr] || [];
    let secCost = port.reduce((sum, x) => sum + (Number(x.cost) || 0), 0);
    if (!secCost) secCost = Number(s.investCost?.[mIdx] || 0);

    const mktEl = document.getElementById("txt-net-worth-market");
    const costEl = document.getElementById("txt-net-worth-cost");
    const secMktEl = document.getElementById("txt-sec-market-val");
    if (mktEl) mktEl.textContent = "NT$ " + Math.round(nonSec + secMkt).toLocaleString();
    if (costEl) costEl.textContent = "NT$ " + Math.round(nonSec + secCost).toLocaleString();
    if (secMktEl) secMktEl.textContent = "$" + Math.round(secMkt).toLocaleString();

    for (const [cName, items] of Object.entries(cats)) {
      const card = document.createElement("div");
      card.className = "glass-card p-3 space-y-1.5 text-xs";
      const sub = items.reduce((sum, x) => sum + x.twdVal, 0);
      card.innerHTML = `<div class="flex justify-between text-slate-400 font-bold mb-1"><span>${esc(cName)}</span><span>NT$ ${Math.round(sub).toLocaleString()}</span></div>`;
      items.forEach(it => {
        card.innerHTML += `
          <div class="flex justify-between items-center py-1 border-b last:border-0">
            <div class="flex items-center gap-1.5"><span>${esc(it.name)}</span><span class="cur-chip cur-${it.fx.cur}">${it.fx.cur}</span></div>
            <div class="font-bold ${it.val < 0 ? "text-rose-400" : ""}">${it.fx.sym} ${Math.round(it.val).toLocaleString()}</div>
          </div>`;
      });
      assetsEl.appendChild(card);
    }
  }

  // 卡費補水同步使用即時餘額
  const gapEl = document.getElementById("card-gap-list");
  if (gapEl) {
    const mappings = [
      { bankName: "台新Richart網銀", cardName: "台新GOGO卡" },
      { bankName: "NewNewBank", cardName: "聯邦賴點卡" },
      { bankName: "國泰交割戶", cardName: "國泰CUBE卡" },
      { bankName: "彰化銀行(信用)", cardName: "彰銀MY購卡" },
      { bankName: "永豐銀行", cardName: "永豐DaWAY" },
      { bankName: "中國信託HB", cardName: "中國信託秀泰卡" },
      { bankName: "玉山銀行", cardName: "玉山Unicard" }
    ];
    gapEl.innerHTML = "";
    mappings.forEach(m => {
      const bBal = Number(liveMap[m.bankName] || 0);
      const cDue = Math.abs(Number(liveMap[m.cardName] || 0));
      const need = Math.max(0, cDue - bBal);
      gapEl.innerHTML += `
        <div class="p-3 rounded-2xl border ${need > 0 ? "bg-rose-500/10 border-rose-500/30" : "bg-slate-800/40"} text-xs space-y-1">
          <div class="flex justify-between font-bold"><span>${esc(m.cardName)}</span><span class="${need > 0 ? "text-rose-400" : "text-emerald-400"}">${need > 0 ? "需補 NT$ " + Math.round(need).toLocaleString() : "餘額充足"}</span></div>
          <div class="flex justify-between text-slate-400"><span>扣款戶：${esc(m.bankName)} ($${Math.round(bBal).toLocaleString()})</span><span>應繳：$${Math.round(cDue).toLocaleString()}</span></div>
        </div>`;
    });
  }
}

// =========================================================================
// 3. 單手滑動分層記帳面板（取代繁瑣表單）
// =========================================================================
let editingTxId = null;

function buildQuickEntryUI() {
  if (document.getElementById("qe-fab")) return;

  // 為底部導覽列加上滑動指示器
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const label = btn.querySelector("span");
    if (label && !label.classList.contains("nav-indicator")) {
      label.classList.add("nav-indicator");
    }
  });

  const fab = document.createElement("button");
  fab.id = "qe-fab";
  fab.title = "單手快速記帳";
  fab.innerHTML = `<i data-lucide="plus" class="w-6 h-6"></i>`;
  document.body.appendChild(fab);

  const sheet = document.createElement("div");
  sheet.id = "qe-modal";
  sheet.className = "hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4";
  sheet.innerHTML = `
    <div class="qe-sheet w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <!-- 頂部：類型左右滑動切換 + 層級指示 -->
      <div id="qe-swipe-header" class="flex items-center justify-between gap-2 pb-2 border-b">
        <div class="flex gap-1 bg-slate-800/60 p-1 rounded-2xl">
          ${["支出", "收入", "轉帳"].map(t => `<button data-qtype="${t}" class="qe-type-btn px-3 py-1 rounded-xl font-bold transition">${t}</button>`).join("")}
        </div>
        <div class="flex items-center gap-1.5">
          <button id="qe-tier-btn" class="px-2.5 py-1 rounded-xl bg-cyan-500/15 text-cyan-400 font-bold border border-cyan-500/30">第1層：金額</button>
          <button id="qe-close-btn" class="p-1 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
      </div>

      <!-- 常用組合一鍵記 -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5" id="qe-presets-bar"></div>

      <!-- 金額顯示區 -->
      <div class="p-3 rounded-2xl bg-slate-800/50 border flex items-center justify-between">
        <div>
          <div class="text-[10px] text-slate-400" id="qe-sel-summary">飲食 · 早餐 · 現金</div>
          <input type="text" id="qe-name-input" class="mt-1 bg-transparent font-medium text-xs w-44" placeholder="備註名稱（可選）">
        </div>
        <div class="text-right">
          <div class="text-[10px] text-slate-400">NT$</div>
          <div id="qe-amount-display" class="text-2xl font-extrabold tracking-tight text-cyan-400">0</div>
        </div>
      </div>

      <!-- 第一層：大數字鍵盤 -->
      <div id="qe-tier-1" class="grid grid-cols-4 gap-2">
        ${["7","8","9","⌫","4","5","6","+","1","2","3","-","C","0","00","="].map(k => `
          <button data-key="${k}" class="qe-key py-3 rounded-2xl bg-slate-800/60 hover:bg-slate-800 font-extrabold text-sm border">${k}</button>
        `).join("")}
      </div>

      <!-- 第二層：主類別與子類別大格子 -->
      <div id="qe-tier-2" class="hidden space-y-2.5">
        <div class="text-[11px] font-bold text-slate-400">主類別（點選展開子類別）</div>
        <div id="qe-main-grid" class="grid grid-cols-3 gap-2"></div>
        <div class="text-[11px] font-bold text-slate-400 pt-1">子類別</div>
        <div id="qe-sub-grid" class="grid grid-cols-3 gap-2"></div>
      </div>

      <!-- 第三層：帳戶、專案、標籤（預設收合） -->
      <div id="qe-tier-3" class="hidden space-y-2.5">
        <div class="grid grid-cols-2 gap-2">
          <div><span class="text-slate-400">扣款/來源帳戶</span><select id="qe-acc-sel" class="w-full p-2 mt-1 border"></select></div>
          <div id="qe-to-acc-box" class="hidden"><span class="text-slate-400">轉入帳戶</span><select id="qe-to-acc-sel" class="w-full p-2 mt-1 border"></select></div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><span class="text-slate-400">專案</span><select id="qe-proj-sel" class="w-full p-2 mt-1 border"></select></div>
          <div><span class="text-slate-400">標籤</span><input type="text" id="qe-tags-inp" class="w-full p-2 mt-1 border" placeholder="#外食"></div>
        </div>
        <button id="qe-save-combo-btn" class="w-full py-2 rounded-xl bg-slate-800 text-cyan-400 font-semibold border">存為常用組合</button>
      </div>

      <!-- 底部操作列 -->
      <div class="grid grid-cols-2 gap-2 pt-1">
        <button id="qe-save-again-btn" class="py-3 rounded-2xl bg-slate-800 font-bold border">儲存並再記一筆</button>
        <button id="qe-save-btn" class="py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow">完成儲存</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  if (window.lucide) window.lucide.createIcons();

  // 接管原本頂部 #btn-quick-tx
  const oldBtn = document.getElementById("btn-quick-tx");
  if (oldBtn) {
    oldBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      openQuickSheet(null);
    }, true);
  }
  fab.addEventListener("click", () => openQuickSheet(null));
  document.getElementById("qe-close-btn").addEventListener("click", () => sheet.classList.add("hidden"));

  // 左右滑動切換 支出 / 收入 / 轉帳
  const types = ["支出", "收入", "轉帳"];
  let sx = 0;
  const hdr = document.getElementById("qe-swipe-header");
  hdr.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  hdr.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 45) {
      const idx = types.indexOf(currentType);
      const nextIdx = dx < 0 ? (idx + 1) % types.length : (idx - 1 + types.length) % types.length;
      setQuickType(types[nextIdx]);
    }
  });

  document.querySelectorAll(".qe-type-btn").forEach(btn => {
    btn.addEventListener("click", () => setQuickType(btn.dataset.qtype));
  });

  // 層級切換按鈕
  document.getElementById("qe-tier-btn").addEventListener("click", () => {
    tierLevel = (tierLevel % 3) + 1;
    applyTierUI();
  });

  // 數字鍵盤
  document.querySelectorAll(".qe-key").forEach(btn => {
    btn.addEventListener("click", () => handleCalcKey(btn.dataset.key));
  });

  document.getElementById("qe-save-btn").addEventListener("click", () => commitQuickTx(false));
  document.getElementById("qe-save-again-btn").addEventListener("click", () => commitQuickTx(true));
  document.getElementById("qe-save-combo-btn").addEventListener("click", saveCurrentAsPreset);
}

function setQuickType(t) {
  currentType = t;
  document.querySelectorAll(".qe-type-btn").forEach(b => {
    const active = b.dataset.qtype === t;
    b.classList.toggle("bg-cyan-500/25", active);
    b.classList.toggle("text-cyan-400", active);
  });
  document.getElementById("qe-to-acc-box").classList.toggle("hidden", t !== "轉帳");
  updateQuickSummary();
}

function applyTierUI() {
  const names = { 1: "第1層：金額", 2: "第2層：類別", 3: "第3層：帳戶/進階" };
  document.getElementById("qe-tier-btn").textContent = names[tierLevel];
  document.getElementById("qe-tier-1").classList.toggle("hidden", tierLevel !== 1);
  document.getElementById("qe-tier-2").classList.toggle("hidden", tierLevel !== 2);
  document.getElementById("qe-tier-3").classList.toggle("hidden", tierLevel !== 3);
}

function handleCalcKey(k) {
  if (k === "C") calcExpr = "";
  else if (k === "⌫") calcExpr = calcExpr.slice(0, -1);
  else if (k === "=") {
    try {
      if (/^[0-9+\-*/().\s]+$/.test(calcExpr)) {
        const res = Function(`"use strict";return (${calcExpr})`)();
        calcExpr = isFinite(res) ? String(Math.max(0, Math.round(res * 100) / 100)) : "";
      }
    } catch (e) {}
  } else {
    calcExpr += k;
  }
  document.getElementById("qe-amount-display").textContent = calcExpr || "0";
}

function openQuickSheet(editTx) {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const mains = Object.keys(cats);
  editingTxId = editTx?.id || null;
  currentType = editTx?.type === "轉出" || editTx?.type === "轉入" ? "轉帳" : (editTx?.type || "支出");
  calcExpr = editTx ? String(Math.abs(Number(editTx.amount || 0))) : "";
  selectedMainCat = editTx?.mainCat || mains[0] || "飲食";
  selectedSubCat = editTx?.subCat || (cats[selectedMainCat]?.[0] || "午餐");
  tierLevel = 1;

  const accs = (state.globalData?.assets?.accounts || []).map(a => a.name).filter(n => !(state.hiddenAccounts || []).includes(n));
  if (!accs.includes("現金")) accs.unshift("現金");

  const catKey = `${selectedMainCat}::${selectedSubCat}`;
  const defaultAcc = editTx?.account || lastCatAccMap[catKey] || accs[0] || "現金";

  const accSel = document.getElementById("qe-acc-sel");
  const toAccSel = document.getElementById("qe-to-acc-sel");
  accSel.innerHTML = accs.map(a => `<option value="${esc(a)}" ${a === defaultAcc ? "selected" : ""}>${esc(a)}</option>`).join("");
  toAccSel.innerHTML = accs.map(a => `<option value="${esc(a)}" ${a === editTx?.toAccount ? "selected" : ""}>${esc(a)}</option>`).join("");

  const projSel = document.getElementById("qe-proj-sel");
  projSel.innerHTML = `<option value="">無專案</option>` + (state.projects || []).map(p => `<option value="${esc(p.name)}" ${p.name === editTx?.project ? "selected" : ""}>${esc(p.name)}</option>`).join("");

  document.getElementById("qe-name-input").value = editTx?.name || "";
  document.getElementById("qe-tags-inp").value = editTx?.tags || "";
  document.getElementById("qe-amount-display").textContent = calcExpr || "0";

  setQuickType(currentType);
  applyTierUI();
  renderPresetsBar();
  renderCategoryGrids();
  updateQuickSummary();

  document.getElementById("qe-modal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function renderPresetsBar() {
  const bar = document.getElementById("qe-presets-bar");
  bar.innerHTML = presets.map((p, idx) => `
    <button data-pidx="${idx}" class="qe-preset-chip shrink-0 px-2.5 py-1 rounded-full bg-slate-800/70 border text-[11px] font-semibold hover:border-cyan-400">${esc(p.label)}</button>
  `).join("");
  bar.querySelectorAll(".qe-preset-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = presets[parseInt(btn.dataset.pidx, 10)];
      if (!p) return;
      currentType = p.type || "支出";
      calcExpr = String(p.amount || "");
      selectedMainCat = p.mainCat || selectedMainCat;
      selectedSubCat = p.subCat || selectedSubCat;
      if (p.account) document.getElementById("qe-acc-sel").value = p.account;
      if (p.name) document.getElementById("qe-name-input").value = p.name;
      document.getElementById("qe-amount-display").textContent = calcExpr || "0";
      setQuickType(currentType);
      renderCategoryGrids();
      updateQuickSummary();
    });
  });
}

function renderCategoryGrids() {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const mains = Object.keys(cats);
  const mGrid = document.getElementById("qe-main-grid");
  const sGrid = document.getElementById("qe-sub-grid");

  mGrid.innerHTML = mains.map(m => `
    <button data-m="${esc(m)}" class="qe-m-btn py-2.5 px-2 rounded-2xl border font-bold truncate ${m === selectedMainCat ? "bg-cyan-500/25 text-cyan-400 border-cyan-500/40" : "bg-slate-800/50"}">${esc(m)}</button>
  `).join("");

  const subs = cats[selectedMainCat] || ["一般"];
  if (!subs.includes(selectedSubCat)) selectedSubCat = subs[0] || "一般";
  sGrid.innerHTML = subs.map(s => `
    <button data-s="${esc(s)}" class="qe-s-btn py-2.5 px-2 rounded-2xl border font-semibold truncate ${s === selectedSubCat ? "bg-emerald-500/25 text-emerald-400 border-emerald-500/40" : "bg-slate-800/50"}">${esc(s)}</button>
  `).join("");

  mGrid.querySelectorAll(".qe-m-btn").forEach(b => {
    b.addEventListener("click", () => {
      selectedMainCat = b.dataset.m;
      selectedSubCat = (cats[selectedMainCat]?.[0]) || "一般";
      const remembered = lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`];
      if (remembered) document.getElementById("qe-acc-sel").value = remembered;
      renderCategoryGrids();
      updateQuickSummary();
    });
  });

  sGrid.querySelectorAll(".qe-s-btn").forEach(b => {
    b.addEventListener("click", () => {
      selectedSubCat = b.dataset.s;
      const remembered = lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`];
      if (remembered) document.getElementById("qe-acc-sel").value = remembered;
      renderCategoryGrids();
      updateQuickSummary();
      // 選好子類別後自動回到第1層方便輸入金額
      tierLevel = 1;
      applyTierUI();
    });
  });
}

function updateQuickSummary() {
  const acc = document.getElementById("qe-acc-sel")?.value || "現金";
  const toAcc = document.getElementById("qe-to-acc-sel")?.value || "";
  const accPart = currentType === "轉帳" ? `${acc} → ${toAcc}` : acc;
  document.getElementById("qe-sel-summary").textContent = `${currentType} · ${selectedMainCat} · ${selectedSubCat} · ${accPart}`;
}

function saveCurrentAsPreset() {
  const amt = parseFloat(calcExpr) || 0;
  const label = document.getElementById("qe-name-input").value.trim() || `${selectedSubCat} ${amt}`;
  presets.unshift({
    label,
    type: currentType,
    amount: amt,
    mainCat: selectedMainCat,
    subCat: selectedSubCat,
    account: document.getElementById("qe-acc-sel").value,
    name: document.getElementById("qe-name-input").value.trim()
  });
  presets = presets.slice(0, 8);
  saveLocalMeta();
  renderPresetsBar();
  window.showToast("已存為常用組合：" + label);
}

async function commitQuickTx(keepOpen) {
  // 若按完成時有算式尚未按 =，先求值
  if (/[+\-*/]/.test(calcExpr)) handleCalcKey("=");
  const amt = parseFloat(calcExpr);
  if (isNaN(amt) || amt <= 0) return alert("請先輸入大於 0 的金額");

  const state = window.__FINANCE_APP__.getState();
  const uid = auth.currentUser.uid;
  const now = new Date();
  const acc = document.getElementById("qe-acc-sel").value;
  const toAcc = currentType === "轉帳" ? document.getElementById("qe-to-acc-sel").value : "";
  const nameVal = document.getElementById("qe-name-input").value.trim() || selectedSubCat;
  const projVal = document.getElementById("qe-proj-sel").value || "";
  const tagsVal = document.getElementById("qe-tags-inp").value.trim() || "";

  lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`] = acc;
  saveLocalMeta();

  const payload = {
    type: currentType,
    account: acc,
    toAccount: toAcc,
    currency: "TWD",
    amount: amt,
    fee: 0,
    discount: 0,
    mainCat: selectedMainCat,
    subCat: selectedSubCat,
    name: nameVal,
    merchant: "",
    date: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    ts: Date.now(),
    project: projVal,
    tags: tagsVal,
    payerEmail: state.currentUser.email,
    payerLabel: state.currentUser.email,
    updatedAt: now.toISOString()
  };

  const isShared = state.activeBookId !== "personal";
  if (editingTxId) {
    if (isShared) await updateDoc(doc(db, "sharedBooks", state.activeBookId, "transactions", editingTxId), payload);
    else await updateDoc(doc(db, "users", uid, "transactions", editingTxId), payload);
    editingTxId = null;
  } else {
    if (isShared) await addDoc(collection(db, "sharedBooks", state.activeBookId, "transactions"), payload);
    else await addDoc(collection(db, "users", uid, "transactions"), payload);
  }

  await window.__FINANCE_APP__.reloadAll();
  window.showToast(`已儲存 ${currentType} $${amt.toLocaleString()}`);

  if (keepOpen) {
    calcExpr = "";
    document.getElementById("qe-amount-display").textContent = "0";
    document.getElementById("qe-name-input").value = "";
    tierLevel = 1;
    applyTierUI();
  } else {
    document.getElementById("qe-modal").classList.add("hidden");
  }
}

// =========================================================================
// 4. 啟動與狀態變更同步
// =========================================================================
loadLocalMeta();
injectEnhancedStyles();

const readyTimer = setInterval(() => {
  const api = window.__FINANCE_APP__;
  const st = api?.getState?.();
  if (st && st.currentUser) {
    clearInterval(readyTimer);
    buildQuickEntryUI();
    patchLedgerAndBalances();
    setInterval(() => {
      if (window.__FINANCE_APP__?.getState?.()?.currentUser) {
        patchLedgerAndBalances();
      }
    }, 1500);
  }
}, 400);