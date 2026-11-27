import { getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, doc, collection, addDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const app = getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const LAST_CAT_ACC_KEY = "mozeLastCatAccV1";
const RECENT_CATS_KEY = "mozeRecentCatsV1";

let calcExpr = "";
let currentType = "支出";
let selectedMainCat = "";
let selectedSubCat = "";
let editingTxSnapshot = null;
let fanOpen = false;
let qeBooted = false;
let activeTypeFilter = "ALL";
let searchQuery = "";
let recentCats = [];
let lastCatAccMap = {};

const DEFAULT_PRESETS = [
  { label: "早餐 55", type: "支出", amount: 55, mainCat: "飲食", subCat: "早餐", account: "現金", name: "早餐" },
  { label: "午餐 120", type: "支出", amount: 120, mainCat: "飲食", subCat: "午餐", account: "現金", name: "午餐" },
  { label: "微糖純茶 45", type: "支出", amount: 45, mainCat: "飲食", subCat: "飲料/點心", account: "現金", name: "微糖純茶" }
];

const CAT_COLORS = {
  "飲食": "#f97316", "交通": "#0ea5e9", "購物": "#ec4899", "娛樂": "#8b5cf6",
  "個人": "#14b8a6", "醫療": "#ef4444", "家居": "#6366f1", "家庭": "#f59e0b",
  "生活": "#10b981", "學習": "#3b82f6", "貓咪": "#f43f5e", "其他": "#64748b"
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function formatIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function detectCurrencyByAccount(accName = "") {
  if (accName.includes("日幣") || accName.includes("JPY")) return "JPY";
  if (accName.includes("韓幣") || accName.includes("韓元") || accName.includes("KRW")) return "KRW";
  if (accName.includes("美金") || accName.includes("美元") || accName.includes("USD")) return "USD";
  return "TWD";
}

function evaluateSafeMath(expr) {
  const cleaned = String(expr || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!cleaned || !/^[0-9+\-*/.]+$/.test(cleaned)) return NaN;
  const tokens = cleaned.match(/(\d+(?:\.\d+)?|[+\-*/])/g);
  if (!tokens) return NaN;

  const stack = [];
  let op = "+";
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (/^[+\-*/]$/.test(tk)) {
      op = tk;
    } else {
      const num = parseFloat(tk);
      if (isNaN(num)) return NaN;
      if (op === "+") stack.push(num);
      else if (op === "-") stack.push(-num);
      else if (op === "*") stack.push((stack.pop() ?? 0) * num);
      else if (op === "/") stack.push(num === 0 ? 0 : (stack.pop() ?? 0) / num);
    }
  }
  return stack.reduce((a, b) => a + b, 0);
}

function getSmartMealSeed() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return { mainCat: "飲食", subCat: "早餐", name: "早餐", amount: 55 };
  if (h >= 11 && h < 14) return { mainCat: "飲食", subCat: "午餐", name: "午餐", amount: 120 };
  if (h >= 17 && h < 21) return { mainCat: "飲食", subCat: "晚餐", name: "晚餐", amount: 150 };
  return null;
}

function loadLocalMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_CAT_ACC_KEY) || "{}");
    if (m && typeof m === "object") lastCatAccMap = m;
  } catch (e) {}
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_CATS_KEY) || "[]");
    if (Array.isArray(r)) recentCats = r;
  } catch (e) {}
}

function saveLocalMeta() {
  try { localStorage.setItem(LAST_CAT_ACC_KEY, JSON.stringify(lastCatAccMap)); } catch (e) {}
  try { localStorage.setItem(RECENT_CATS_KEY, JSON.stringify(recentCats)); } catch (e) {}
}

function getPresetsList() {
  const st = window.__FINANCE_APP__?.getState?.();
  return (st?.presetCombos && st.presetCombos.length) ? st.presetCombos : DEFAULT_PRESETS;
}

function injectEnhancedStyles() {
  if (document.getElementById("qe-enhanced-style")) return;
  const style = document.createElement("style");
  style.id = "qe-enhanced-style";
  style.textContent = `
    #qe-center-fan-btn {
      width: 48px; height: 42px; border-radius: 16px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--soft-dark-accent); color: #f8fafc;
      border: 1px solid rgba(125, 211, 252, 0.35);
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.24);
      transition: transform .18s ease;
      flex-shrink: 0;
    }
    #qe-center-fan-btn.active { transform: rotate(45deg); }

    #qe-fan-backdrop {
      position: fixed; inset: 0; z-index: 38;
      background: rgba(15, 23, 42, 0.24);
      opacity: 0; pointer-events: none; transition: opacity .18s ease;
    }
    #qe-fan-backdrop.open { opacity: 1; pointer-events: auto; }

    #qe-fan-layer {
      position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 42px);
      width: 0; height: 0; z-index: 42; pointer-events: none;
    }
    .qe-fan-node {
      position: absolute; left: 0; top: 0; padding: 8px 13px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 800; line-height: 1.1; color: #f8fafc;
      background: linear-gradient(135deg, #2b384e, #3b4d6b);
      border: 1px solid rgba(148, 163, 184, 0.45);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.30);
      opacity: 0; pointer-events: none; white-space: nowrap;
      transform: translate(-50%, -50%) scale(0.5);
      transition: transform .22s cubic-bezier(.18, .9, .28, 1.12), opacity .15s ease;
    }
    #qe-fan-layer.open .qe-fan-node {
      opacity: 1; pointer-events: auto;
      transform: translate(calc(-50% + var(--fx)), calc(-50% + var(--fy))) scale(1);
    }
    .qe-fan-node.is-more { background: var(--soft-dark-accent); }

    .qe-sheet {
      background-color: var(--glass-strong);
      -webkit-backdrop-filter: blur(36px) saturate(180%); backdrop-filter: blur(36px) saturate(180%);
      border: 1px solid var(--card-border);
      border-radius: 1.85rem 1.85rem 0 0;
      animation: qeUp .24s cubic-bezier(.2,.9,.25,1);
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
    }
    @media (min-width: 640px) { .qe-sheet { border-radius: 1.85rem; } }
    @keyframes qeUp { from { transform: translateY(32px); opacity: 0; } to { transform: none; opacity: 1; } }

    .qe-key-btn {
      background-color: var(--btn-sec-bg); color: var(--ink);
      border: 1px solid var(--btn-sec-border);
      font-weight: 800; font-size: 17px; min-height: 46px;
    }

    .date-group-header {
      position: sticky; top: 56px; z-index: 15;
      background-color: var(--header-bg);
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    }

    .swipe-row-wrap { position: relative; overflow: hidden; border-radius: 16px; }
    .swipe-action-bg {
      position: absolute; inset: 0; z-index: 1;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 16px; font-size: 13px; font-weight: 800;
      opacity: 0; transition: opacity .15s ease;
      background: linear-gradient(90deg, rgba(56,189,248,.18), rgba(251,113,133,.20));
    }
    .swipe-row-wrap.swiping .swipe-action-bg { opacity: 1; }
    .swipe-row-content {
      position: relative; z-index: 2;
      background-color: var(--glass-flat); border: 1px solid var(--line);
      border-radius: 16px; transition: transform .18s ease; touch-action: pan-y;
    }
  `;
  document.head.appendChild(style);
}

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
  accounts.forEach(a => { baseMap[a.name] = Number(a.values?.[mIdx] || 0); });

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
  const state = window.__FINANCE_APP__?.getState?.();
  const selMonth = document.getElementById("select-month");
  if (!selMonth || !state || !state.globalData) return;

  const mIdx = parseInt(selMonth.value || "0", 10);
  const monthStr = selMonth.options[selMonth.selectedIndex]?.text || "";
  const targetYm = parseYmKeyFromLabel(monthStr);

  const isShared = state.activeBookId !== "personal";
  const sourceList = (isShared ? state.sharedTx : state.personalTx)
    .slice()
    .sort((a, b) => txToTimestamp(b) - txToTimestamp(a));

  const kw = searchQuery.trim().toLowerCase();
  const monthAll = sourceList.filter(tx => !targetYm || parseYmKeyFromDateStr(tx.date) === targetYm);

  let expSum = 0, incSum = 0;
  monthAll.forEach(tx => {
    const amt = Math.abs(Number(tx.amount || 0));
    if (tx.type === "支出" || tx.type === "應付款項") expSum += amt;
    if (tx.type === "收入" || tx.type === "退款") incSum += amt;
  });

  const expEl = document.getElementById("txt-month-expense");
  const incEl = document.getElementById("txt-month-income");
  const netEl = document.getElementById("txt-month-net");
  if (expEl) expEl.textContent = `NT$ ${Math.round(expSum).toLocaleString()}`;
  if (incEl) incEl.textContent = `NT$ ${Math.round(incSum).toLocaleString()}`;
  if (netEl) {
    const net = Math.round(incSum - expSum);
    netEl.textContent = `${net >= 0 ? "+" : ""}NT$ ${net.toLocaleString()}`;
  }

  const filtered = monthAll.filter(tx => {
    if (activeTypeFilter !== "ALL" && tx.type !== activeTypeFilter) return false;
    if (!kw) return true;
    const hay = `${tx.name || ""} ${tx.mainCat || ""} ${tx.subCat || ""} ${tx.merchant || ""} ${tx.account || ""} ${tx.tags || ""}`.toLowerCase();
    return hay.includes(kw);
  });

  const cntEl = document.getElementById("txt-tx-count");
  if (cntEl) cntEl.textContent = `${filtered.length} 筆`;

  const listEl = document.getElementById("tx-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = `<div class="glass-card text-sm text-slate-400 py-8 text-center">本月尚無符合條件的記帳紀錄<br><span class="text-xs">點選底部中央「＋」立即記一筆</span></div>`;
    } else {
      const groups = new Map();
      filtered.forEach(tx => {
        const dKey = String(tx.date || "未指定日期").replace(/\//g, "-");
        if (!groups.has(dKey)) groups.set(dKey, []);
        groups.get(dKey).push(tx);
      });

      groups.forEach((items, dKey) => {
        let dayExp = 0;
        items.forEach(t => {
          if (t.type === "支出" || t.type === "應付款項") dayExp += Math.abs(Number(t.amount || 0));
        });

        const grpWrap = document.createElement("div");
        grpWrap.className = "space-y-1.5";
        grpWrap.innerHTML = `
          <div class="date-group-header flex justify-between items-center px-2 py-1 rounded-xl text-xs font-bold text-slate-400">
            <span>${esc(dKey)}</span>
            <span>日支出 NT$ ${Math.round(dayExp).toLocaleString()}</span>
          </div>`;

        items.forEach(tx => {
          const isOut = (tx.type === "支出" || tx.type === "轉出" || tx.type === "應付款項");
          const isXfer = (tx.type === "轉帳" || tx.type === "轉出" || tx.type === "轉入");
          const sign = isXfer ? "" : (isOut ? "-" : "+");
          const colorCls = isXfer ? "text-cyan-400" : (isOut ? "text-rose-400" : "text-emerald-400");
          const dotColor = CAT_COLORS[tx.mainCat] || "#64748b";
          const initialChar = (tx.mainCat || tx.type || "帳").slice(0, 1);

          const wrap = document.createElement("div");
          wrap.className = "swipe-row-wrap";
          wrap.innerHTML = `
            <div class="swipe-action-bg">
              <span class="text-cyan-400">→ 編輯</span>
              <span class="text-rose-400">刪除 ←</span>
            </div>
            <div class="swipe-row-content p-3 flex justify-between items-center gap-2.5">
              <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-sm shrink-0" style="background-color:${dotColor}">
                ${esc(initialChar)}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[15px] font-bold truncate">${esc(tx.name || tx.subCat || tx.mainCat || tx.type)}</div>
                <div class="text-xs text-slate-400 truncate mt-0.5">${esc(tx.mainCat || "")}${tx.subCat ? " · " + esc(tx.subCat) : ""} · ${esc(tx.account || "")}${tx.toAccount ? " → " + esc(tx.toAccount) : ""}${tx.project ? " · #" + esc(tx.project) : ""}</div>
              </div>
              <div class="text-[15px] font-extrabold whitespace-nowrap shrink-0 ${colorCls}">${sign}${esc(tx.currency || "TWD")} ${Math.abs(Number(tx.amount || 0)).toLocaleString()}</div>
            </div>`;

          const content = wrap.querySelector(".swipe-row-content");
          let startX = 0, startY = 0, curDx = 0, lockedAxis = null;
          content.addEventListener("touchstart", (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            curDx = 0;
            lockedAxis = null;
          }, { passive: true });
          content.addEventListener("touchmove", (e) => {
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (!lockedAxis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
              lockedAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            }
            if (lockedAxis === "x") {
              curDx = dx;
              wrap.classList.add("swiping");
              content.style.transform = `translateX(${Math.max(-80, Math.min(80, curDx))}px)`;
            }
          }, { passive: true });
          content.addEventListener("touchend", async () => {
            content.style.transform = "";
            wrap.classList.remove("swiping");
            if (lockedAxis === "x" && curDx < -55) {
              const backupCopy = { ...tx };
              delete backupCopy.id;
              const uid = auth.currentUser.uid;
              const bookId = state.activeBookId;
              if (isShared) await deleteDoc(doc(db, "sharedBooks", bookId, "transactions", tx.id));
              else await deleteDoc(doc(db, "users", uid, "transactions", tx.id));

              window.showToast("已刪除紀錄", false, async () => {
                if (isShared) await addDoc(collection(db, "sharedBooks", bookId, "transactions"), backupCopy);
                else await addDoc(collection(db, "users", uid, "transactions"), backupCopy);
                window.showToast("已復原紀錄");
              });
            } else if (lockedAxis === "x" && curDx > 55) {
              openQuickSheet(tx, null);
            }
            curDx = 0;
            lockedAxis = null;
          });
          content.addEventListener("click", () => openQuickSheet(tx, null));
          grpWrap.appendChild(wrap);
        });

        listEl.appendChild(grpWrap);
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
    const secCostEl = document.getElementById("txt-sec-cost-val");
    const secPlEl = document.getElementById("txt-sec-pl");
    if (mktEl) mktEl.textContent = "NT$ " + Math.round(nonSec + secMkt).toLocaleString();
    if (costEl) costEl.textContent = "NT$ " + Math.round(nonSec + secCost).toLocaleString();
    if (secMktEl) secMktEl.textContent = "$" + Math.round(secMkt).toLocaleString();
    if (secCostEl) secCostEl.textContent = "$" + Math.round(secCost).toLocaleString();
    if (secPlEl) {
      const pl = Math.round(secMkt - secCost);
      secPlEl.textContent = `${pl >= 0 ? "+" : ""}$${pl.toLocaleString()}`;
      secPlEl.className = `font-bold mt-0.5 ${pl >= 0 ? "text-emerald-400" : "text-rose-400"}`;
    }

    for (const [cName, items] of Object.entries(cats)) {
      const card = document.createElement("div");
      card.className = "glass-card p-3.5 space-y-1.5 text-sm";
      const sub = items.reduce((sum, x) => sum + x.twdVal, 0);
      card.innerHTML = `<div class="flex justify-between text-xs text-slate-400 font-bold mb-1"><span>${esc(cName)}</span><span>NT$ ${Math.round(sub).toLocaleString()}</span></div>`;
      items.forEach(it => {
        card.innerHTML += `
          <div class="flex justify-between items-center py-1.5 border-b last:border-0">
            <div class="flex items-center gap-1.5"><span class="text-[15px] font-medium">${esc(it.name)}</span><span class="cur-chip cur-${it.fx.cur}">${it.fx.cur}</span></div>
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
          <div class="flex justify-between font-bold text-sm"><span>${esc(m.cardName)}</span><span class="${need > 0 ? "text-rose-400" : "text-emerald-400"}">${need > 0 ? "需補 NT$ " + Math.round(need).toLocaleString() : "餘額充足"}</span></div>
          <div class="flex justify-between text-slate-400"><span>扣款戶：${esc(m.bankName)} ($${Math.round(bBal).toLocaleString()})</span><span>應繳：$${Math.round(cDue).toLocaleString()}</span></div>
        </div>`;
    });
  }

  renderStatisticsCharts(state, monthAll, mIdx);
}

function renderStatisticsCharts(state, monthAll, mIdx) {
  const donutBox = document.getElementById("chart-category-donut");
  const barsBox = document.getElementById("chart-monthly-bars");
  const lineBox = document.getElementById("chart-networth-line");
  if (!donutBox || !barsBox || !lineBox) return;

  const catTotals = {};
  let totalExp = 0;
  monthAll.forEach(tx => {
    if (tx.type !== "支出" && tx.type !== "應付款項") return;
    const amt = Math.abs(Number(tx.amount || 0));
    const cat = tx.mainCat || "其他";
    catTotals[cat] = (catTotals[cat] || 0) + amt;
    totalExp += amt;
  });

  document.getElementById("stats-cat-total").textContent = `NT$ ${Math.round(totalExp).toLocaleString()}`;
  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  if (!sortedCats.length || totalExp <= 0) {
    donutBox.innerHTML = `<div class="text-xs text-slate-400 py-4 text-center w-full">本月尚無支出資料</div>`;
  } else {
    const r = 46, cx = 60, cy = 60, circ = 2 * Math.PI * r;
    let offset = 0;
    const segs = sortedCats.map(([cat, val]) => {
      const pct = val / totalExp;
      const dash = pct * circ;
      const color = CAT_COLORS[cat] || "#64748b";
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="${color}" stroke-width="16" stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return seg;
    }).join("");

    const legend = sortedCats.slice(0, 6).map(([cat, val]) => {
      const pct = Math.round((val / totalExp) * 100);
      const color = CAT_COLORS[cat] || "#64748b";
      return `<div class="flex items-center justify-between text-xs py-0.5">
        <span class="flex items-center gap-1.5 font-semibold"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${color}"></span>${esc(cat)}</span>
        <span class="text-slate-400 font-bold">${pct}% ($${Math.round(val).toLocaleString()})</span>
      </div>`;
    }).join("");

    donutBox.innerHTML = `
      <svg width="120" height="120" viewBox="0 0 120 120" class="shrink-0">${segs}</svg>
      <div class="flex-1 w-full space-y-1">${legend}</div>`;
  }

  const months = state.globalData?.assets?.months || [];
  const sliceStart = Math.max(0, months.length - 6);
  const recentMonths = months.slice(sliceStart);
  const isShared = state.activeBookId !== "personal";
  const allTx = isShared ? state.sharedTx : state.personalTx;

  const series = recentMonths.map(mLabel => {
    const ym = parseYmKeyFromLabel(mLabel);
    let exp = 0, inc = 0;
    allTx.forEach(t => {
      if (parseYmKeyFromDateStr(t.date) !== ym) return;
      const a = Math.abs(Number(t.amount || 0));
      if (t.type === "支出" || t.type === "應付款項") exp += a;
      if (t.type === "收入" || t.type === "退款") inc += a;
    });
    return { label: mLabel, exp, inc };
  });

  const maxBar = Math.max(1, ...series.flatMap(s => [s.exp, s.inc]));
  barsBox.innerHTML = `<div class="grid grid-cols-${Math.max(1, series.length)} gap-2 items-end h-32 pt-4">
    ${series.map(s => {
      const expH = Math.max(4, Math.round((s.exp / maxBar) * 84));
      const incH = Math.max(4, Math.round((s.inc / maxBar) * 84));
      return `<div class="flex flex-col items-center gap-1">
        <div class="flex items-end gap-1 h-24">
          <div class="w-3 rounded-t bg-rose-400" style="height:${expH}px" title="支出 $${Math.round(s.exp).toLocaleString()}"></div>
          <div class="w-3 rounded-t bg-emerald-400" style="height:${incH}px" title="收入 $${Math.round(s.inc).toLocaleString()}"></div>
        </div>
        <span class="text-xs text-slate-400 font-semibold">${esc(s.label)}</span>
      </div>`;
    }).join("")}
  </div>`;

  const accs = state.globalData?.assets?.accounts || [];
  const nwSeries = recentMonths.map((mLabel, idx) => {
    const realIdx = sliceStart + idx;
    let sum = 0;
    accs.forEach(a => {
      if ((state.hiddenAccounts || []).includes(a.name)) return;
      if (["股票代號", "股票名", "現值"].includes(a.name) || a.name.includes(".TW")) return;
      if (a.name === "國泰嚕哪基金" || a.name === "彰化銀行(房貸)") return;
      sum += Number(a.values?.[realIdx] || 0);
    });
    return { label: mLabel, val: sum };
  });

  const latestNw = nwSeries[nwSeries.length - 1]?.val || 0;
  document.getElementById("stats-nw-latest").textContent = `NT$ ${Math.round(latestNw).toLocaleString()}`;

  if (nwSeries.length < 2) {
    lineBox.innerHTML = `<div class="text-xs text-slate-400 py-3 text-center">累積 2 個月以上資產快照後顯示走勢線</div>`;
  } else {
    const vals = nwSeries.map(d => d.val);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);
    const w = 300, h = 80, pad = 12;
    const pts = nwSeries.map((d, i) => {
      const x = pad + (i * (w - pad * 2)) / (nwSeries.length - 1);
      const y = h - pad - ((d.val - minV) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    lineBox.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-24 overflow-visible">
        <polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
      </svg>
      <div class="flex justify-between text-xs text-slate-400 font-semibold">
        <span>${esc(nwSeries[0].label)}</span>
        <span>${esc(nwSeries[nwSeries.length - 1].label)}</span>
      </div>`;
  }
}

function getAccountList() {
  const state = window.__FINANCE_APP__.getState();
  const accs = (state.globalData?.assets?.accounts || [])
    .map(a => a.name)
    .filter(n => !(state.hiddenAccounts || []).includes(n))
    .filter(n => !["股票代號", "股票名", "現值"].includes(n) && !n.includes(".TW"));
  if (!accs.includes("現金")) accs.unshift("現金");
  return accs;
}

function getTopFanItems() {
  const state = window.__FINANCE_APP__.getState();
  const cats = Object.keys(state.categories || {});
  const ordered = [...new Set([...recentCats, ...cats])].filter(c => cats.includes(c));
  const top5 = ordered.slice(0, 5).map(m => ({
    label: m,
    type: "支出",
    mainCat: m,
    subCat: (state.categories[m]?.[0]) || "一般"
  }));
  top5.push({ label: "更多", type: "支出", mainCat: ordered[0] || "飲食", subCat: "午餐", isMore: true });
  return top5;
}

function openFanMenu() {
  const fanLayer = document.getElementById("qe-fan-layer");
  const backdrop = document.getElementById("qe-fan-backdrop");
  const btn = document.getElementById("qe-center-fan-btn");
  if (!fanLayer || !backdrop) return;

  const items = getTopFanItems();
  const radius = 108;
  const startDeg = -150, endDeg = -30;
  fanLayer.innerHTML = "";

  items.forEach((it, i) => {
    const deg = startDeg + ((endDeg - startDeg) * i) / (items.length - 1);
    const rad = (deg * Math.PI) / 180;
    const fx = Math.cos(rad) * radius;
    const fy = Math.sin(rad) * radius;
    const node = document.createElement("button");
    node.type = "button";
    node.className = `qe-fan-node ${it.isMore ? "is-more" : ""}`;
    node.style.setProperty("--fx", `${fx.toFixed(1)}px`);
    node.style.setProperty("--fy", `${fy.toFixed(1)}px`);
    node.textContent = it.label;
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFanMenu();
      openQuickSheet(null, it);
    });
    fanLayer.appendChild(node);
  });

  fanOpen = true;
  btn?.classList.add("active");
  backdrop.classList.add("open");
  fanLayer.classList.add("open");
}

function closeFanMenu() {
  fanOpen = false;
  document.getElementById("qe-center-fan-btn")?.classList.remove("active");
  document.getElementById("qe-fan-backdrop")?.classList.remove("open");
  document.getElementById("qe-fan-layer")?.classList.remove("open");
}

function buildQuickEntryUI() {
  if (document.getElementById("qe-modal")) return;

  document.getElementById("inp-tx-search")?.addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    patchLedgerAndBalances();
  });
  document.querySelectorAll(".ftype-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      activeTypeFilter = chip.dataset.ftype;
      document.querySelectorAll(".ftype-chip").forEach(c => {
        c.classList.remove("btn-primary");
        c.classList.add("btn-secondary");
      });
      chip.classList.remove("btn-secondary");
      chip.classList.add("btn-primary");
      patchLedgerAndBalances();
    });
  });

  const centerBtn = document.getElementById("qe-center-fan-btn");
  if (centerBtn) {
    let pressTimer = null;
    let longTriggered = false;
    centerBtn.addEventListener("pointerdown", () => {
      longTriggered = false;
      pressTimer = setTimeout(() => {
        longTriggered = true;
        openFanMenu();
      }, 360);
    });
    centerBtn.addEventListener("pointerup", () => {
      clearTimeout(pressTimer);
      if (!longTriggered) {
        if (fanOpen) closeFanMenu();
        else openQuickSheet(null, getSmartMealSeed());
      }
    });
    centerBtn.addEventListener("pointercancel", () => clearTimeout(pressTimer));
  }

  const backdrop = document.createElement("div");
  backdrop.id = "qe-fan-backdrop";
  backdrop.addEventListener("click", () => closeFanMenu());
  document.body.appendChild(backdrop);

  const fanLayer = document.createElement("div");
  fanLayer.id = "qe-fan-layer";
  document.body.appendChild(fanLayer);

  const sheet = document.createElement("div");
  sheet.id = "qe-modal";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.className = "hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4";
  sheet.innerHTML = `
    <div id="qe-sheet-card" class="qe-sheet w-full max-w-md p-4 space-y-2.5 max-h-[94vh] overflow-y-auto text-xs">
      <div id="qe-grabber-zone" class="pt-0.5 pb-1 flex flex-col items-center cursor-grab">
        <div class="w-10 h-1.5 rounded-full bg-slate-400/40"></div>
      </div>

      <div class="flex items-center justify-between gap-2 pb-1.5 border-b">
        <div class="flex gap-1 bg-slate-800/40 p-1 rounded-2xl">
          ${["支出", "收入", "轉帳"].map(t => `<button data-qtype="${t}" class="qe-type-btn px-3 py-1.5 rounded-xl text-xs font-bold transition">${t}</button>`).join("")}
        </div>
        <div class="flex items-center gap-1.5">
          <button id="qe-more-toggle" class="px-2.5 py-1.5 rounded-xl btn-secondary text-xs font-bold">進階欄位</button>
          <button id="qe-close-btn" aria-label="關閉視窗" class="p-1.5 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
      </div>

      <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5" id="qe-presets-bar"></div>

      <div class="p-3 rounded-2xl bg-slate-800/40 border flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-cyan-400 truncate" id="qe-sel-summary">支出 · 飲食 · 午餐</div>
          <input type="text" id="qe-name-input" class="mt-1.5 px-2.5 py-1.5 w-full" placeholder="備註名稱（可選）">
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs font-bold text-slate-400" id="qe-cur-label">TWD</div>
          <div id="qe-amount-display" class="text-3xl font-extrabold tracking-tight text-cyan-400">0</div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <select id="qe-acc-sel" aria-label="選擇帳戶" class="w-full p-2 font-bold"></select>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" id="qe-date-today" class="px-2.5 py-2 rounded-xl btn-primary text-xs font-bold shrink-0">今天</button>
          <button type="button" id="qe-date-yest" class="px-2.5 py-2 rounded-xl btn-secondary text-xs font-bold shrink-0">昨天</button>
          <input type="date" id="qe-date-inp" aria-label="選擇日期" class="w-full p-1.5">
        </div>
      </div>

      <div id="qe-xfer-to-wrap" class="hidden">
        <span class="text-xs text-cyan-400 font-bold">轉入帳戶</span>
        <select id="qe-to-acc-sel" aria-label="轉入帳戶" class="w-full p-2 mt-1 font-bold"></select>
      </div>

      <div class="space-y-1.5">
        <div id="qe-main-chips" class="flex items-center gap-1.5 overflow-x-auto pb-0.5"></div>
        <div id="qe-sub-chips" class="flex items-center gap-1.5 overflow-x-auto pb-0.5"></div>
      </div>

      <div id="qe-advanced-panel" class="hidden p-3 rounded-2xl bg-slate-800/40 border space-y-2">
        <div class="grid grid-cols-2 gap-2">
          <div><span class="text-slate-400">專案</span><select id="qe-proj-sel" aria-label="專案" class="w-full p-2 mt-1"></select></div>
          <div><span class="text-slate-400">手續費</span><input type="number" inputmode="decimal" id="qe-fee-inp" class="w-full p-2 mt-1" placeholder="0"></div>
        </div>
        <div><span class="text-slate-400">標籤</span><input type="text" id="qe-tags-inp" class="w-full p-2 mt-1" placeholder="#外食"></div>
        <button id="qe-save-combo-btn" class="w-full py-2 rounded-xl btn-secondary font-semibold">存為雲端常用組合</button>
      </div>

      <div class="grid grid-cols-4 gap-1.5 pt-0.5">
        ${["7","8","9","⌫","4","5","6","×","1","2","3","÷","C","0","+","-"].map(k => `
          <button type="button" data-key="${k}" class="qe-key-btn rounded-2xl">${esc(k)}</button>
        `).join("")}
      </div>

      <div class="grid grid-cols-3 gap-2 pt-1">
        <button type="button" data-key="=" class="qe-key-btn rounded-2xl font-extrabold">=</button>
        <button id="qe-save-again-btn" class="py-3 rounded-2xl btn-secondary text-sm font-bold">再記一筆</button>
        <button id="qe-save-btn" class="py-3 rounded-2xl btn-primary text-sm font-bold">完成儲存</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  if (window.lucide) lucide.createIcons();

  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) sheet.classList.add("hidden");
  });
  document.getElementById("qe-close-btn").addEventListener("click", () => sheet.classList.add("hidden"));

  let grabStartY = 0;
  const grabZone = document.getElementById("qe-grabber-zone");
  grabZone.addEventListener("touchstart", (e) => { grabStartY = e.touches[0].clientY; }, { passive: true });
  grabZone.addEventListener("touchend", (e) => {
    if (e.changedTouches[0].clientY - grabStartY > 55) sheet.classList.add("hidden");
  });

  document.getElementById("qe-more-toggle").addEventListener("click", () => {
    document.getElementById("qe-advanced-panel").classList.toggle("hidden");
  });

  document.querySelectorAll(".qe-type-btn").forEach(btn => {
    btn.addEventListener("click", () => setQuickType(btn.dataset.qtype));
  });

  document.querySelectorAll(".qe-key-btn").forEach(btn => {
    btn.addEventListener("click", () => handleCalcKey(btn.dataset.key));
  });

  const dateInp = document.getElementById("qe-date-inp");
  const btnToday = document.getElementById("qe-date-today");
  const btnYest = document.getElementById("qe-date-yest");
  const syncDateChips = () => {
    const todayStr = formatIsoDate(new Date());
    const yestStr = formatIsoDate(new Date(Date.now() - 86400000));
    btnToday.className = `px-2.5 py-2 rounded-xl text-xs font-bold shrink-0 ${dateInp.value === todayStr ? "btn-primary" : "btn-secondary"}`;
    btnYest.className = `px-2.5 py-2 rounded-xl text-xs font-bold shrink-0 ${dateInp.value === yestStr ? "btn-primary" : "btn-secondary"}`;
  };
  btnToday.addEventListener("click", () => { dateInp.value = formatIsoDate(new Date()); syncDateChips(); });
  btnYest.addEventListener("click", () => { dateInp.value = formatIsoDate(new Date(Date.now() - 86400000)); syncDateChips(); });
  dateInp.addEventListener("change", syncDateChips);

  document.getElementById("qe-acc-sel").addEventListener("change", () => updateQuickSummary());
  document.getElementById("qe-to-acc-sel").addEventListener("change", () => updateQuickSummary());
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
  const isXfer = (t === "轉帳");
  document.getElementById("qe-xfer-to-wrap").classList.toggle("hidden", !isXfer);
  const accSel = document.getElementById("qe-acc-sel");
  const toSel = document.getElementById("qe-to-acc-sel");
  if (isXfer && accSel.value === toSel.value) {
    const other = Array.from(toSel.options).find(o => o.value !== accSel.value);
    if (other) toSel.value = other.value;
  }
  updateQuickSummary();
}

function handleCalcKey(k) {
  if (k === "C") calcExpr = "";
  else if (k === "⌫") calcExpr = calcExpr.slice(0, -1);
  else if (k === "=") {
    const res = evaluateSafeMath(calcExpr);
    calcExpr = isFinite(res) ? String(Math.round(res * 100) / 100) : "";
  } else {
    calcExpr += k;
  }
  document.getElementById("qe-amount-display").textContent = calcExpr || "0";
}

function normalizeDateForInput(dateStr) {
  if (!dateStr) return formatIsoDate(new Date());
  const parts = String(dateStr).replace(/\//g, "-").split("-");
  if (parts.length === 3) {
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  return formatIsoDate(new Date());
}

function openQuickSheet(editTx, presetSeed) {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const mains = Object.keys(cats);
  const seed = editTx || presetSeed || null;

  editingTxSnapshot = editTx ? { ...editTx } : null;
  currentType = seed?.type === "轉出" || seed?.type === "轉入" ? "轉帳" : (seed?.type || "支出");
  calcExpr = seed?.amount ? String(Math.abs(Number(seed.amount))) : "";
  selectedMainCat = seed?.mainCat || recentCats[0] || mains[0] || "飲食";
  selectedSubCat = seed?.subCat || (cats[selectedMainCat]?.[0] || "午餐");

  const accs = getAccountList();
  const catKey = `${selectedMainCat}::${selectedSubCat}`;
  const defaultAcc = seed?.account || lastCatAccMap[catKey] || accs[0] || "現金";
  const defaultToAcc = editTx?.toAccount || accs.find(a => a !== defaultAcc) || accs[0] || "現金";

  const accSel = document.getElementById("qe-acc-sel");
  const toSel = document.getElementById("qe-to-acc-sel");
  const optsHtml = accs.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  accSel.innerHTML = optsHtml;
  toSel.innerHTML = optsHtml;
  accSel.value = defaultAcc;
  toSel.value = defaultToAcc;

  const projSel = document.getElementById("qe-proj-sel");
  projSel.innerHTML = `<option value="">無專案</option>` + (state.projects || []).map(p => `<option value="${esc(p.name)}" ${p.name === editTx?.project ? "selected" : ""}>${esc(p.name)}</option>`).join("");

  const dateInp = document.getElementById("qe-date-inp");
  dateInp.value = normalizeDateForInput(editTx?.date);
  document.getElementById("qe-date-today").className = `px-2.5 py-2 rounded-xl text-xs font-bold shrink-0 ${dateInp.value === formatIsoDate(new Date()) ? "btn-primary" : "btn-secondary"}`;
  document.getElementById("qe-date-yest").className = `px-2.5 py-2 rounded-xl text-xs font-bold shrink-0 ${dateInp.value === formatIsoDate(new Date(Date.now() - 86400000)) ? "btn-primary" : "btn-secondary"}`;

  document.getElementById("qe-name-input").value = seed?.name || "";
  document.getElementById("qe-fee-inp").value = editTx?.fee || "";
  document.getElementById("qe-tags-inp").value = editTx?.tags || "";
  document.getElementById("qe-amount-display").textContent = calcExpr || "0";

  setQuickType(currentType);
  renderPresetsBar();
  renderCategoryChips();
  updateQuickSummary();

  document.getElementById("qe-modal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function renderPresetsBar() {
  const bar = document.getElementById("qe-presets-bar");
  const list = getPresetsList();
  bar.innerHTML = list.map((p, idx) => `
    <button data-pidx="${idx}" class="qe-preset-chip shrink-0 px-3 py-1.5 rounded-full btn-secondary text-xs font-bold">${esc(p.label)}</button>
  `).join("");
  bar.querySelectorAll(".qe-preset-chip").forEach(btn => {
    let holdTimer = null;
    const idx = parseInt(btn.dataset.pidx, 10);
    btn.addEventListener("pointerdown", () => {
      holdTimer = setTimeout(async () => {
        const cur = [...getPresetsList()];
        const removed = cur.splice(idx, 1);
        if (removed.length && window.__FINANCE_APP__?.savePresetsCloud) {
          await window.__FINANCE_APP__.savePresetsCloud(cur);
          renderPresetsBar();
          window.showToast("已刪除常用組合");
        }
      }, 600);
    });
    btn.addEventListener("pointerup", () => clearTimeout(holdTimer));
    btn.addEventListener("click", () => {
      const p = getPresetsList()[idx];
      if (!p) return;
      currentType = p.type || "支出";
      calcExpr = String(p.amount || "");
      selectedMainCat = p.mainCat || selectedMainCat;
      selectedSubCat = p.subCat || selectedSubCat;
      if (p.account) document.getElementById("qe-acc-sel").value = p.account;
      if (p.name) document.getElementById("qe-name-input").value = p.name;
      document.getElementById("qe-amount-display").textContent = calcExpr || "0";
      setQuickType(currentType);
      renderCategoryChips();
      updateQuickSummary();
    });
  });
}

function renderCategoryChips() {
  const state = window.__FINANCE_APP__.getState();
  const cats = state.categories || {};
  const allMains = Object.keys(cats);
  const orderedMains = [...new Set([...recentCats, ...allMains])].filter(m => allMains.includes(m));

  const mRow = document.getElementById("qe-main-chips");
  const sRow = document.getElementById("qe-sub-chips");

  mRow.innerHTML = orderedMains.map(m => `
    <button type="button" data-m="${esc(m)}" class="qe-m-chip shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${m === selectedMainCat ? "btn-primary" : "btn-secondary"}">${esc(m)}</button>
  `).join("");

  const subs = cats[selectedMainCat] || ["一般"];
  if (!subs.includes(selectedSubCat)) selectedSubCat = subs[0] || "一般";
  sRow.innerHTML = subs.map(s => `
    <button type="button" data-s="${esc(s)}" class="qe-s-chip shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${s === selectedSubCat ? "btn-primary" : "btn-secondary"}">${esc(s)}</button>
  `).join("");

  mRow.querySelectorAll(".qe-m-chip").forEach(b => {
    b.addEventListener("click", () => {
      selectedMainCat = b.dataset.m;
      selectedSubCat = (cats[selectedMainCat]?.[0]) || "一般";
      const remembered = lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`];
      if (remembered) document.getElementById("qe-acc-sel").value = remembered;
      renderCategoryChips();
      updateQuickSummary();
    });
  });

  sRow.querySelectorAll(".qe-s-chip").forEach(b => {
    b.addEventListener("click", () => {
      selectedSubCat = b.dataset.s;
      const remembered = lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`];
      if (remembered) document.getElementById("qe-acc-sel").value = remembered;
      renderCategoryChips();
      updateQuickSummary();
    });
  });
}

function updateQuickSummary() {
  const acc = document.getElementById("qe-acc-sel")?.value || "現金";
  const toAcc = document.getElementById("qe-to-acc-sel")?.value || "";
  const accPart = currentType === "轉帳" ? `${acc} → ${toAcc}` : acc;
  const cur = editingTxSnapshot?.currency || detectCurrencyByAccount(acc);
  const curEl = document.getElementById("qe-cur-label");
  if (curEl) curEl.textContent = cur;
  document.getElementById("qe-sel-summary").textContent = `${currentType} · ${selectedMainCat} · ${selectedSubCat} · ${accPart}`;
}

async function saveCurrentAsPreset() {
  const amt = parseFloat(calcExpr) || 0;
  const label = document.getElementById("qe-name-input").value.trim() || `${selectedSubCat} ${amt}`;
  const next = [{
    label,
    type: currentType,
    amount: amt,
    mainCat: selectedMainCat,
    subCat: selectedSubCat,
    account: document.getElementById("qe-acc-sel").value,
    name: document.getElementById("qe-name-input").value.trim()
  }, ...getPresetsList()].slice(0, 10);

  if (window.__FINANCE_APP__?.savePresetsCloud) {
    await window.__FINANCE_APP__.savePresetsCloud(next);
  }
  renderPresetsBar();
  window.showToast("已存為雲端常用組合：" + label);
}

async function commitQuickTx(keepOpen) {
  if (/[+\-*/×÷]/.test(calcExpr)) handleCalcKey("=");
  const amt = parseFloat(calcExpr);
  if (isNaN(amt) || amt <= 0) return alert("請先輸入大於 0 的金額");

  const state = window.__FINANCE_APP__.getState();
  const uid = auth.currentUser.uid;
  const now = new Date();
  const acc = document.getElementById("qe-acc-sel").value;
  const toAcc = currentType === "轉帳" ? document.getElementById("qe-to-acc-sel").value : "";
  if (currentType === "轉帳" && (!acc || !toAcc || acc === toAcc)) {
    return alert("請選擇兩個不同的轉出與轉入帳戶");
  }

  const nameVal = document.getElementById("qe-name-input").value.trim() || (currentType === "轉帳" ? `${acc}→${toAcc}` : selectedSubCat);
  const projVal = document.getElementById("qe-proj-sel").value || "";
  const tagsVal = document.getElementById("qe-tags-inp").value.trim() || "";
  const feeVal = parseFloat(document.getElementById("qe-fee-inp").value) || 0;
  const pickedDate = document.getElementById("qe-date-inp").value || formatIsoDate(now);

  lastCatAccMap[`${selectedMainCat}::${selectedSubCat}`] = acc;
  recentCats = [selectedMainCat, ...recentCats.filter(c => c !== selectedMainCat)].slice(0, 8);
  saveLocalMeta();

  const isShared = state.activeBookId !== "personal";

  if (editingTxSnapshot) {
    const origTime = editingTxSnapshot.time || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const parsedTs = Date.parse(`${pickedDate.replace(/-/g, "/")} ${origTime}`);
    const payload = {
      ...editingTxSnapshot,
      type: currentType,
      account: acc,
      toAccount: toAcc,
      currency: editingTxSnapshot.currency || detectCurrencyByAccount(acc),
      amount: amt,
      fee: feeVal,
      mainCat: selectedMainCat,
      subCat: selectedSubCat,
      name: nameVal,
      date: pickedDate,
      time: origTime,
      ts: !isNaN(parsedTs) ? parsedTs : (editingTxSnapshot.ts || Date.now()),
      project: projVal,
      tags: tagsVal,
      updatedAt: now.toISOString()
    };
    delete payload.id;

    if (isShared) await updateDoc(doc(db, "sharedBooks", state.activeBookId, "transactions", editingTxSnapshot.id), payload);
    else await updateDoc(doc(db, "users", uid, "transactions", editingTxSnapshot.id), payload);
    editingTxSnapshot = null;
  } else {
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const parsedTs = Date.parse(`${pickedDate.replace(/-/g, "/")} ${timeStr}`);
    const payload = {
      type: currentType,
      account: acc,
      toAccount: toAcc,
      currency: detectCurrencyByAccount(acc),
      amount: amt,
      fee: feeVal,
      discount: 0,
      mainCat: selectedMainCat,
      subCat: selectedSubCat,
      name: nameVal,
      merchant: "",
      date: pickedDate,
      time: timeStr,
      ts: !isNaN(parsedTs) ? parsedTs : Date.now(),
      project: projVal,
      tags: tagsVal,
      payerEmail: state.currentUser.email,
      payerLabel: state.currentUser.email,
      updatedAt: now.toISOString()
    };

    if (isShared) await addDoc(collection(db, "sharedBooks", state.activeBookId, "transactions"), payload);
    else await addDoc(collection(db, "users", uid, "transactions"), payload);
  }

  window.showToast(`已儲存 ${currentType} $${amt.toLocaleString()}`);

  if (keepOpen) {
    calcExpr = "";
    document.getElementById("qe-amount-display").textContent = "0";
    document.getElementById("qe-name-input").value = "";
  } else {
    document.getElementById("qe-modal").classList.add("hidden");
  }
}

loadLocalMeta();
injectEnhancedStyles();

function bootQuickEntry() {
  if (qeBooted) return;
  const st = window.__FINANCE_APP__?.getState?.();
  if (!st || !st.currentUser) return;
  qeBooted = true;
  buildQuickEntryUI();
  patchLedgerAndBalances();
}

window.addEventListener("finance:ready", bootQuickEntry);
window.addEventListener("finance:render", () => {
  bootQuickEntry();
  patchLedgerAndBalances();
});
bootQuickEntry();