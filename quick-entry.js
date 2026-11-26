import { getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, doc, collection, addDoc, updateDoc, deleteDoc
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
let tierLevel = 1;
let editingTxId = null;
let fanOpen = false;

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
// 1. 樣式強化（底部中央扇形快選 + 自適應防重疊 + 按鍵高對比 + 明細防疊字）
// =========================================================================
function injectEnhancedStyles() {
  if (document.getElementById("qe-enhanced-style")) return;
  const style = document.createElement("style");
  style.id = "qe-enhanced-style";
  style.textContent = `
    .nav-indicator { position: relative; }
    .nav-indicator::after {
      content: ""; position: absolute; bottom: 2px; width: 16px; height: 3px;
      border-radius: 999px; background: var(--accent); opacity: 0;
      transform: scaleX(0.4); transition: opacity .22s ease, transform .22s ease;
    }
    .nav-btn.text-cyan-400 .nav-indicator::after { opacity: 1; transform: scaleX(1); }

    /* 底部導覽列中央嵌入的扇形快選鈕（紅框位置） */
    #qe-center-fan-btn {
      width: 42px;
      height: 36px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--soft-dark-btn);
      color: #f8fafc;
      border: 1px solid var(--soft-dark-border);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.22);
      transition: transform .18s ease, background .18s ease;
      flex-shrink: 0;
    }
    #qe-center-fan-btn:active { transform: scale(.92); }
    #qe-center-fan-btn.active {
      background: var(--soft-dark-accent);
      transform: rotate(45deg);
    }

    /* 扇形展開遮罩與節點層 */
    #qe-fan-backdrop {
      position: fixed;
      inset: 0;
      z-index: 38;
      background: rgba(15, 23, 42, 0.22);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
    }
    #qe-fan-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    #qe-fan-layer {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 34px);
      width: 0;
      height: 0;
      z-index: 42;
      pointer-events: none;
    }

    .qe-fan-node {
      position: absolute;
      left: 0;
      top: 0;
      padding: 7px 12px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.1;
      color: #f8fafc;
      background: linear-gradient(135deg, #2b384e, #3b4d6b);
      border: 1px solid rgba(148, 163, 184, 0.45);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.30);
      opacity: 0;
      pointer-events: none;
      white-space: nowrap;
      transform: translate(-50%, -50%) scale(0.5);
      transition: transform .24s cubic-bezier(.18, .9, .28, 1.12), opacity .16s ease;
    }
    #qe-fan-layer.open .qe-fan-node {
      opacity: 1;
      pointer-events: auto;
      transform: translate(calc(-50% + var(--fx)), calc(-50% + var(--fy))) scale(1);
    }
    .qe-fan-node:active {
      filter: brightness(1.18);
    }
    .qe-fan-node.is-xfer {
      background: var(--soft-dark-accent);
      border-color: rgba(125, 211, 252, 0.5);
    }

    /* 超過 12 項時的自適應多列居中面板備援，絕不溢出螢幕 */
    #qe-fan-grid-fallback {
      position: fixed;
      left: 14px;
      right: 14px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
      max-width: 420px;
      margin: 0 auto;
      z-index: 42;
      display: none;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      border-radius: 22px;
      background: var(--glass-strong);
      border: 1px solid var(--card-border);
      box-shadow: var(--shadow);
    }
    #qe-fan-grid-fallback.open { display: flex; }

    .qe-sheet {
      background-color: var(--glass-strong);
      -webkit-backdrop-filter: blur(42px) saturate(180%);
      backdrop-filter: blur(42px) saturate(180%);
      border: 1px solid var(--card-border);
      border-radius: 1.85rem 1.85rem 0 0;
      animation: qeUp .26s cubic-bezier(.2,.9,.25,1);
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
    }
    @media (min-width: 640px) { .qe-sheet { border-radius: 1.85rem; } }
    @keyframes qeUp { from { transform: translateY(32px); opacity: 0; } to { transform: none; opacity: 1; } }

    .qe-key-btn {
      background-color: #e6eae6;
      color: #1e293b;
      border: 1px solid rgba(30,41,59,.14);
      font-weight: 800;
      font-size: 15px;
      transition: transform .1s ease, background-color .12s ease;
    }
    :root[data-theme="dark"] .qe-key-btn {
      background-color: #2f3d54;
      color: #f8fafc;
      border: 1px solid rgba(148,163,184,.28);
    }
    .qe-key-btn:active {
      transform: scale(.94);
      background-color: #cbd5e1;
      color: #0f172a;
    }
    :root[data-theme="dark"] .qe-key-btn:active {
      background-color: #475b7a;
      color: #ffffff;
    }

    .swipe-row-wrap {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      margin: 5px 0;
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
      font-weight: 800;
      opacity: 0;
      transition: opacity .15s ease;
      background: linear-gradient(90deg, rgba(56,189,248,.18), rgba(251,113,133,.20));
    }
    .swipe-row-wrap.swiping .swipe-action-bg { opacity: 1; }
    .swipe-row-content {
      position: relative;
      z-index: 2;
      background-color: var(--glass-flat);
      border: 1px solid var(--line);
      border-radius: 14px;
      transition: transform .18s ease;
      touch-action: pan-y;
    }
  `;
  document.head.appendChild(style);
}

// =========================================================================
// 2. 流水連動餘額、轉帳排除收支統計、明細防疊字與左右滑動
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

function computeLiveAccountBalances(state, mIdx, monthStr) {
  const targetYm = parseYmKeyFromLabel(monthStr);
  const accounts = state.globalData?.assets?.accounts || [];
  const baseMap = {};
  accounts.forEach(a => {
    baseMap[a.name] = Number(a.values?.[mIdx] || 0);
  });

  const myEmail = (state.currentUser?.email || "").toLowerCase();
  const monthPersonal = (state.personalTx || []).filter(t => parseYmKeyFromDateStr(t.date) === targetYm);
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

    if (tx.type === "支出" || tx.type === "應付款項") {
      baseMap[tx.account] -= netOut;
    } else if (tx.type === "收入" || tx.type === "退款" || tx.type === "應收款項") {
      baseMap[tx.account] += netIn;
    }
  };

  monthPersonal.forEach(applyDelta);
  monthSharedMyPaid.forEach(applyDelta);

  return baseMap;
}

function patchLedgerAndBalances() {
  const state = window.__FINANCE_APP__.getState();
  const selMonth = document.getElementById("select-month");
  if (!selMonth || !state.globalData) return;

  const mIdx = parseInt(selMonth.value || "0", 10);
  const monthStr = selMonth.options[selMonth.selectedIndex]?.text || "";
  const targetYm = parseYmKeyFromLabel(monthStr);

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

  const listEl = document.getElementById("tx-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">尚無記帳紀錄，點選底部中央「＋」扇形選單或右上角「記帳」。</div>`;
    } else {
      filtered.forEach(tx => {
        const isOut = (tx.type === "支出" || tx.type === "轉出" || tx.type === "應付款項");
        const isXfer = (tx.type === "轉帳" || tx.type === "轉出" || tx.type === "轉入");
        const sign = isXfer ? "" : (isOut ? "-" : "+");
        const colorCls = isXfer ? "text-cyan-400" : (isOut ? "text-rose-400" : "text-emerald-400");

        const wrap = document.createElement("div");
        wrap.className = "swipe-row-wrap";
        wrap.innerHTML = `
          <div class="swipe-action-bg">
            <span class="text-cyan-400">← 編輯</span>
            <span class="text-rose-400">刪除 →</span>
          </div>
          <div class="swipe-row-content p-2.5 flex justify-between items-center gap-2 text-xs">
            <div class="min-w-0 flex-1">
              <div class="font-bold truncate">${esc(tx.name || tx.subCat || tx.mainCat || tx.type)} <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">${esc(tx.mainCat || "")}${tx.subCat ? "·" + esc(tx.subCat) : ""}</span></div>
              <div class="text-[10px] text-slate-400 truncate mt-0.5">${esc(tx.date || "")} ${esc(tx.time || "")} · ${esc(tx.account || "")}${tx.toAccount ? " → " + esc(tx.toAccount) : ""}${tx.project ? " · #" + esc(tx.project) : ""}${isShared && tx.payerLabel ? " · 付:" + esc(tx.payerLabel) : ""}</div>
            </div>
            <div class="font-extrabold whitespace-nowrap shrink-0 ${colorCls}">${sign}${esc(tx.currency || "TWD")} ${Math.abs(Number(tx.amount || 0)).toLocaleString()}</div>
          </div>`;

        const content = wrap.querySelector(".swipe-row-content");
        let startX = 0, curDx = 0;
        content.addEventListener("touchstart", (e) => {
          startX = e.touches[0].clientX;
          curDx = 0;
        }, { passive: true });
        content.addEventListener("touchmove", (e) => {
          curDx = e.touches[0].clientX - startX;
          if (Math.abs(curDx) > 12) {
            wrap.classList.add("swiping");
            content.style.transform = `translateX(${Math.max(-76, Math.min(76, curDx))}px)`;
          }
        }, { passive: true });
        content.addEventListener("touchend", async () => {
          content.style.transform = "";
          wrap.classList.remove("swiping");
          if (curDx < -55) {
            const uid = auth.currentUser.uid;
            if (isShared) await deleteDoc(doc(db, "sharedBooks", state.activeBookId, "transactions", tx.id));
            else await deleteDoc(doc(db, "users", uid, "transactions", tx.id));
            await window.__FINANCE_APP__.reloadAll();
            window.showToast("已刪除紀錄");
          } else if (curDx > 55) {
            openQuickSheet(tx, null);
          }
          curDx = 0;
        });
        content.addEventListener("dblclick", () => openQuickSheet(tx, null));
        listEl.appendChild(wrap);
      });
    }
  }

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
            <div class="font-bold whitespace-nowrap ${it.val < 0 ? "text-rose-400" : ""}">${it.fx.sym} ${Math.round(it.val).toLocaleString()}</div>
          </div>`;
      });
      assetsEl.appendChild(card);
    }
  }

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
// 3. 底部中央置中扇形選單（自動依選項數量與螢幕寬度調整，不破圖不疊圖）
// =========================================================================
function getAccountList() {
  const state = window.__FINANCE_APP__.getState();
  const accs = (state.globalData?.assets?.accounts || [])
    .map(a => a.name)
    .filter(n => !(state.hiddenAccounts || []).includes(n))
    .filter(n => !["股票代號", "股票名", "現值"].includes(n) && !n.includes(".TW"));
  if (!accs.includes("現金")) accs.unshift("現金");
  return accs;
}

function getFanDynamicItems() {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const mainNames = Object.keys(cats);
  const items = mainNames.map(m => ({
    label: m,
    type: "支出",
    mainCat: m,
    subCat: (cats[m] && cats[m][0]) || "一般"
  }));
  items.push({
    label: "轉帳",
    type: "轉帳",
    mainCat: "其他",
    subCat: "轉帳/調整",
    isXfer: true
  });
  return items;
}

function renderAdaptiveFanNodes() {
  const fanLayer = document.getElementById("qe-fan-layer");
  const fallbackGrid = document.getElementById("qe-fan-grid-fallback");
  if (!fanLayer || !fallbackGrid) return;

  const items = getFanDynamicItems();
  const vw = Math.min(window.innerWidth || 393, 440);
  // 留左右各 38px 安全邊距，確保膠囊絕不切出螢幕左右邊緣
  const maxHalfSpan = Math.max(115, (vw / 2) - 42);

  fanLayer.innerHTML = "";
  fallbackGrid.innerHTML = "";

  // 若選項超過 13 個，自動切換為置中自適應圓弧膠囊群組，保證絕不重疊
  if (items.length > 13) {
    fanLayer.dataset.mode = "grid";
    items.forEach((it, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `px-3 py-2 rounded-full text-xs font-extrabold text-slate-50 border ${it.isXfer ? "btn-soft-accent" : "btn-soft-dark"}`;
      btn.textContent = it.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeFanMenu();
        openQuickSheet(null, it);
      });
      fallbackGrid.appendChild(btn);
    });
    return;
  }

  fanLayer.dataset.mode = "arc";

  // 依據總數量自動分成 1 圈（<=5項）或 2 圈同心上弧（6~13項）
  const rings = [];
  if (items.length <= 5) {
    rings.push({ list: items, radius: Math.min(126, maxHalfSpan * 0.96), startDeg: -158, endDeg: -22 });
  } else {
    const innerCount = Math.min(5, Math.ceil(items.length * 0.42));
    const innerList = items.slice(0, innerCount);
    const outerList = items.slice(innerCount);
    const innerR = Math.min(96, maxHalfSpan * 0.72);
    const outerR = Math.min(156, maxHalfSpan * 1.02);
    rings.push({ list: innerList, radius: innerR, startDeg: -152, endDeg: -28 });
    rings.push({ list: outerList, radius: outerR, startDeg: -164, endDeg: -16 });
  }

  rings.forEach((ring, rIdx) => {
    const n = ring.list.length;
    ring.list.forEach((it, i) => {
      const deg = n === 1
        ? -90
        : ring.startDeg + ((ring.endDeg - ring.startDeg) * i) / (n - 1);
      const rad = (deg * Math.PI) / 180;
      // 限制水平偏移不超過 maxHalfSpan，垂直往上展開
      const rawX = Math.cos(rad) * ring.radius;
      const fx = Math.max(-maxHalfSpan, Math.min(maxHalfSpan, rawX));
      const fy = Math.sin(rad) * ring.radius - (rIdx * 6);

      const node = document.createElement("button");
      node.type = "button";
      node.className = `qe-fan-node ${it.isXfer ? "is-xfer" : ""}`;
      node.style.setProperty("--fx", `${fx.toFixed(1)}px`);
      node.style.setProperty("--fy", `${fy.toFixed(1)}px`);
      node.style.transitionDelay = `${(rIdx * 3 + i) * 18}ms`;
      node.textContent = it.label;

      node.addEventListener("click", (e) => {
        e.stopPropagation();
        closeFanMenu();
        openQuickSheet(null, it);
      });
      fanLayer.appendChild(node);
    });
  });
}

function openFanMenu() {
  renderAdaptiveFanNodes();
  fanOpen = true;
  const btn = document.getElementById("qe-center-fan-btn");
  const backdrop = document.getElementById("qe-fan-backdrop");
  const fanLayer = document.getElementById("qe-fan-layer");
  const fallbackGrid = document.getElementById("qe-fan-grid-fallback");

  if (btn) btn.classList.add("active");
  if (backdrop) backdrop.classList.add("open");
  if (fanLayer?.dataset.mode === "grid") {
    fallbackGrid?.classList.add("open");
  } else {
    fanLayer?.classList.add("open");
  }
}

function closeFanMenu() {
  fanOpen = false;
  document.getElementById("qe-center-fan-btn")?.classList.remove("active");
  document.getElementById("qe-fan-backdrop")?.classList.remove("open");
  document.getElementById("qe-fan-layer")?.classList.remove("open");
  document.getElementById("qe-fan-grid-fallback")?.classList.remove("open");
}

function buildQuickEntryUI() {
  if (document.getElementById("qe-center-fan-btn")) return;

  // 清除舊版懸浮群組（若殘留）
  document.getElementById("qe-fab-group")?.remove();

  // 將扇形觸發鈕置中嵌入底部 <nav> 紅框位置（目前：記帳明細 與 切換頁面 之間）
  const bottomNav = document.querySelector("nav.fixed");
  const togglePagesBtn = document.getElementById("btn-toggle-pages");
  if (bottomNav && togglePagesBtn) {
    const centerBtn = document.createElement("button");
    centerBtn.id = "qe-center-fan-btn";
    centerBtn.type = "button";
    centerBtn.title = "扇形快速記帳";
    centerBtn.setAttribute("aria-label", "扇形快速記帳");
    centerBtn.innerHTML = `<i data-lucide="plus" class="w-5 h-5"></i>`;
    bottomNav.insertBefore(centerBtn, togglePagesBtn);

    centerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (fanOpen) closeFanMenu();
      else openFanMenu();
    });
  }

  // 點擊背景遮罩收起扇形選單
  const backdrop = document.createElement("div");
  backdrop.id = "qe-fan-backdrop";
  backdrop.addEventListener("click", () => closeFanMenu());
  document.body.appendChild(backdrop);

  const fanLayer = document.createElement("div");
  fanLayer.id = "qe-fan-layer";
  document.body.appendChild(fanLayer);

  const fallbackGrid = document.createElement("div");
  fallbackGrid.id = "qe-fan-grid-fallback";
  document.body.appendChild(fallbackGrid);

  window.addEventListener("resize", () => {
    if (fanOpen) renderAdaptiveFanNodes();
  });

  // 建立毛玻璃記帳 Bottom Sheet
  const sheet = document.createElement("div");
  sheet.id = "qe-modal";
  sheet.className = "hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4";
  sheet.innerHTML = `
    <div class="qe-sheet w-full max-w-md p-4 space-y-2.5 max-h-[92vh] overflow-y-auto text-xs">
      <div id="qe-swipe-header" class="flex items-center justify-between gap-2 pb-2 border-b">
        <div class="flex gap-1 bg-slate-800/60 p-1 rounded-2xl">
          ${["支出", "收入", "轉帳"].map(t => `<button data-qtype="${t}" class="qe-type-btn px-3 py-1 rounded-xl font-bold transition">${t}</button>`).join("")}
        </div>
        <div class="flex items-center gap-1.5">
          <button id="qe-tier-btn" class="px-2.5 py-1 rounded-xl btn-soft-dark font-bold">第1層：金額</button>
          <button id="qe-close-btn" class="p-1 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
      </div>

      <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5" id="qe-presets-bar"></div>

      <!-- 轉帳專屬快速帳戶選擇列 -->
      <div id="qe-xfer-quick-bar" class="hidden p-2 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 grid grid-cols-2 gap-2">
        <div>
          <span class="text-[10px] text-slate-400 block">轉出帳戶</span>
          <select id="qe-acc-sel" class="w-full p-1.5 mt-0.5 text-xs font-bold"></select>
        </div>
        <div>
          <span class="text-[10px] text-cyan-400 block">轉入帳戶</span>
          <select id="qe-to-acc-sel" class="w-full p-1.5 mt-0.5 text-xs font-bold"></select>
        </div>
      </div>

      <!-- 金額顯示區 -->
      <div class="p-3 rounded-2xl bg-slate-800/50 border flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[11px] font-bold text-cyan-400 truncate" id="qe-sel-summary">支出 · 飲食 · 午餐 · 現金</div>
          <input type="text" id="qe-name-input" class="mt-1 px-2 py-1 text-xs w-44" placeholder="備註名稱（可選）">
        </div>
        <div class="text-right shrink-0">
          <div class="text-[10px] text-slate-400">NT$</div>
          <div id="qe-amount-display" class="text-2xl font-extrabold tracking-tight text-cyan-400">0</div>
        </div>
      </div>

      <!-- 第一層：大數字鍵盤 -->
      <div id="qe-tier-1" class="grid grid-cols-4 gap-2">
        ${["7","8","9","⌫","4","5","6","+","1","2","3","-","C","0","00","="].map(k => `
          <button data-key="${k}" class="qe-key-btn py-3 rounded-2xl">${esc(k)}</button>
        `).join("")}
      </div>

      <!-- 第二層：主類別與子類別大格子 -->
      <div id="qe-tier-2" class="hidden space-y-2.5">
        <div class="text-[11px] font-bold text-slate-400">主類別（點選展開子類別）</div>
        <div id="qe-main-grid" class="grid grid-cols-3 gap-2"></div>
        <div class="text-[11px] font-bold text-slate-400 pt-1">子類別</div>
        <div id="qe-sub-grid" class="grid grid-cols-3 gap-2"></div>
      </div>

      <!-- 第三層：帳戶、專案、標籤 -->
      <div id="qe-tier-3" class="hidden space-y-2.5">
        <div id="qe-normal-acc-box">
          <span class="text-slate-400">扣款 / 入帳帳戶</span>
          <select id="qe-acc-sel-normal" class="w-full p-2 mt-1"></select>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><span class="text-slate-400">專案</span><select id="qe-proj-sel" class="w-full p-2 mt-1"></select></div>
          <div><span class="text-slate-400">標籤</span><input type="text" id="qe-tags-inp" class="w-full p-2 mt-1" placeholder="#外食"></div>
        </div>
        <button id="qe-save-combo-btn" class="w-full py-2 rounded-xl btn-soft-dark font-semibold">存為常用組合</button>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-1">
        <button id="qe-save-again-btn" class="py-3 rounded-2xl btn-soft-dark font-bold">儲存並再記一筆</button>
        <button id="qe-save-btn" class="py-3 rounded-2xl btn-soft-accent font-bold">完成儲存</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  if (window.lucide) lucide.createIcons();

  const oldBtn = document.getElementById("btn-quick-tx");
  if (oldBtn) {
    oldBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      closeFanMenu();
      openQuickSheet(null, null);
    }, true);
  }
  document.getElementById("qe-close-btn").addEventListener("click", () => sheet.classList.add("hidden"));

  const types = ["支出", "收入", "轉帳"];
  let sx = 0;
  const hdr = document.getElementById("qe-swipe-header");
  hdr.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  hdr.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 45) {
      const idx = types.indexOf(currentType);
      setQuickType(types[dx < 0 ? (idx + 1) % types.length : (idx - 1 + types.length) % types.length]);
    }
  });

  document.querySelectorAll(".qe-type-btn").forEach(btn => {
    btn.addEventListener("click", () => setQuickType(btn.dataset.qtype));
  });

  document.getElementById("qe-tier-btn").addEventListener("click", () => {
    tierLevel = (tierLevel % 3) + 1;
    applyTierUI();
  });

  document.querySelectorAll(".qe-key-btn").forEach(btn => {
    btn.addEventListener("click", () => handleCalcKey(btn.dataset.key));
  });

  const accXfer = document.getElementById("qe-acc-sel");
  const accNorm = document.getElementById("qe-acc-sel-normal");
  const accTo = document.getElementById("qe-to-acc-sel");
  accXfer.addEventListener("change", () => {
    accNorm.value = accXfer.value;
    if (accTo.value === accXfer.value) {
      const other = Array.from(accTo.options).find(o => o.value !== accXfer.value);
      if (other) accTo.value = other.value;
    }
    updateQuickSummary();
  });
  accNorm.addEventListener("change", () => {
    accXfer.value = accNorm.value;
    updateQuickSummary();
  });
  accTo.addEventListener("change", () => updateQuickSummary());

  document.getElementById("qe-save-btn").addEventListener("click", () => commitQuickTx(false));
  document.getElementById("qe-save-again-btn").addEventListener("click", () => commitQuickTx(true));
  document.getElementById("qe-save-combo-btn").addEventListener("click", saveCurrentAsPreset);
}

function getSelectedAccount() {
  return currentType === "轉帳"
    ? document.getElementById("qe-acc-sel").value
    : document.getElementById("qe-acc-sel-normal").value;
}

function setQuickType(t) {
  currentType = t;
  document.querySelectorAll(".qe-type-btn").forEach(b => {
    const active = b.dataset.qtype === t;
    b.classList.toggle("bg-cyan-500/25", active);
    b.classList.toggle("text-cyan-400", active);
  });
  const isXfer = (t === "轉帳");
  document.getElementById("qe-xfer-quick-bar").classList.toggle("hidden", !isXfer);
  document.getElementById("qe-normal-acc-box").classList.toggle("hidden", isXfer);

  const accXfer = document.getElementById("qe-acc-sel");
  const accTo = document.getElementById("qe-to-acc-sel");
  if (isXfer && accXfer.value === accTo.value) {
    const other = Array.from(accTo.options).find(o => o.value !== accXfer.value);
    if (other) accTo.value = other.value;
  }
  updateQuickSummary();
}

function applyTierUI() {
  const names = { 1: "第1層：金額", 2: "第2層：類別", 3: "第3層：進階" };
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

function openQuickSheet(editTx, presetSeed) {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const mains = Object.keys(cats);
  const seed = editTx || presetSeed || null;

  editingTxId = editTx?.id || null;
  currentType = seed?.type === "轉出" || seed?.type === "轉入" ? "轉帳" : (seed?.type || "支出");
  calcExpr = seed?.amount ? String(Math.abs(Number(seed.amount))) : "";
  selectedMainCat = seed?.mainCat || mains[0] || "飲食";
  selectedSubCat = seed?.subCat || (cats[selectedMainCat]?.[0] || "午餐");
  // 若從扇形選單點入且該主類別有多個子類別，先展開第 2 層方便選子類別，否則直接第 1 層輸金額
  tierLevel = (presetSeed && !presetSeed.isXfer && (cats[selectedMainCat]?.length || 0) > 1) ? 2 : 1;

  const accs = getAccountList();
  const catKey = `${selectedMainCat}::${selectedSubCat}`;
  const defaultAcc = seed?.account || lastCatAccMap[catKey] || accs[0] || "現金";
  const defaultToAcc = editTx?.toAccount || accs.find(a => a !== defaultAcc) || accs[0] || "現金";

  const accXfer = document.getElementById("qe-acc-sel");
  const accNorm = document.getElementById("qe-acc-sel-normal");
  const accTo = document.getElementById("qe-to-acc-sel");

  const optsHtml = accs.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  accXfer.innerHTML = optsHtml;
  accNorm.innerHTML = optsHtml;
  accTo.innerHTML = optsHtml;

  accXfer.value = defaultAcc;
  accNorm.value = defaultAcc;
  accTo.value = defaultToAcc;

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
    <button data-pidx="${idx}" class="qe-preset-chip shrink-0 px-2.5 py-1 rounded-full btn-soft-dark text-[11px] font-semibold">${esc(p.label)}</button>
  `).join("");
  bar.querySelectorAll(".qe-preset-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = presets[parseInt(btn.dataset.pidx, 10)];
      if (!p) return;
      currentType = p.type || "支出";
      calcExpr = String(p.amount || "");
      selectedMainCat = p.mainCat || selectedMainCat;
      selectedSubCat = p.subCat || selectedSubCat;
      if (p.account) {
        document.getElementById("qe-acc-sel").value = p.account;
        document.getElementById("qe-acc-sel-normal").value = p.account;
      }
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
      if (remembered) {
        document.getElementById("qe-acc-sel").value = remembered;
        document.getElementById("qe-acc-sel-normal").value = remembered;
      }
      renderCategoryGrids();
      updateQuickSummary();
    });
  });

  sGrid.querySelectorAll(".qe-s-btn").forEach(b => {
    b.addEventListener("click", () => {
      selectedSubCat = b.dataset.s;
      const remembered = lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`];
      if (remembered) {
        document.getElementById("qe-acc-sel").value = remembered;
        document.getElementById("qe-acc-sel-normal").value = remembered;
      }
      renderCategoryGrids();
      updateQuickSummary();
      tierLevel = 1;
      applyTierUI();
    });
  });
}

function updateQuickSummary() {
  const acc = getSelectedAccount() || "現金";
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
    account: getSelectedAccount(),
    name: document.getElementById("qe-name-input").value.trim()
  });
  presets = presets.slice(0, 8);
  saveLocalMeta();
  renderPresetsBar();
  window.showToast("已存為常用組合：" + label);
}

async function commitQuickTx(keepOpen) {
  if (/[+\-*/]/.test(calcExpr)) handleCalcKey("=");
  const amt = parseFloat(calcExpr);
  if (isNaN(amt) || amt <= 0) return alert("請先輸入大於 0 的金額");

  const state = window.__FINANCE_APP__.getState();
  const uid = auth.currentUser.uid;
  const now = new Date();
  const acc = getSelectedAccount();
  const toAcc = currentType === "轉帳" ? document.getElementById("qe-to-acc-sel").value : "";
  if (currentType === "轉帳" && (!acc || !toAcc || acc === toAcc)) {
    return alert("請選擇兩個不同的轉出與轉入帳戶");
  }

  const nameVal = document.getElementById("qe-name-input").value.trim() || (currentType === "轉帳" ? `${acc}→${toAcc}` : selectedSubCat);
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
  patchLedgerAndBalances();
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