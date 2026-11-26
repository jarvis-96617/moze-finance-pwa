import { getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const app = getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const BACKUP_META_KEY = "mozeLastBackupIso";
const BACKUP_INTERVAL_DAYS = 7;

let notifyRules = [];
let pendingDrafts = [];
let unsubDrafts = null;
let stage3Booted = false;

function bootStage3() {
  if (stage3Booted) return;
  const state = window.__FINANCE_APP__?.getState?.();
  if (state && state.currentUser && document.getElementById("top-tools-drawer")) {
    stage3Booted = true;
    initStage3(state.currentUser);
  }
}

window.addEventListener("finance:ready", bootStage3);
window.addEventListener("finance:render", bootStage3);
bootStage3();

async function initStage3(user) {
  injectDrawerButtons();
  injectStage3Modals();
  await loadNotifyRules(user.uid);
  startDraftsListener(user.uid);
  checkPeriodicBackupReminder();
}

function injectDrawerButtons() {
  const drawer = document.getElementById("top-tools-drawer");
  if (!drawer || document.getElementById("btn-open-drafts")) return;

  const btnDraft = document.createElement("button");
  btnDraft.id = "btn-open-drafts";
  btnDraft.className = "p-2 rounded-xl btn-soft-dark flex items-center justify-center gap-1.5";
  btnDraft.innerHTML = `<i data-lucide="bell" class="w-3.5 h-3.5 text-amber-400"></i><span>通知草稿</span><span id="draft-badge" class="hidden px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">0</span>`;

  const btnCsv = document.createElement("button");
  btnCsv.id = "btn-open-csv";
  btnCsv.className = "p-2 rounded-xl btn-soft-dark flex items-center justify-center gap-1.5";
  btnCsv.innerHTML = `<i data-lucide="file-spreadsheet" class="w-3.5 h-3.5 text-emerald-400"></i><span>MOZE CSV</span>`;

  const btnCloseMonth = document.createElement("button");
  btnCloseMonth.id = "btn-open-wizard";
  btnCloseMonth.className = "p-2 rounded-xl btn-soft-dark flex items-center justify-center gap-1.5";
  btnCloseMonth.innerHTML = `<i data-lucide="clipboard-check" class="w-3.5 h-3.5 text-purple-400"></i><span>月結確認</span>`;

  drawer.insertBefore(btnCloseMonth, drawer.firstChild);
  drawer.insertBefore(btnCsv, drawer.firstChild);
  drawer.insertBefore(btnDraft, drawer.firstChild);
  if (window.lucide) window.lucide.createIcons();

  btnDraft.addEventListener("click", () => {
    drawer.classList.add("hidden");
    renderDraftsModal();
    document.getElementById("drafts-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  });
  btnCsv.addEventListener("click", () => {
    drawer.classList.add("hidden");
    document.getElementById("csv-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  });
  btnCloseMonth.addEventListener("click", () => {
    drawer.classList.add("hidden");
    openSettlementWizard();
  });
}

function checkPeriodicBackupReminder() {
  const lastIso = localStorage.getItem(BACKUP_META_KEY);
  const daysPassed = lastIso ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 86400000) : 999;
  if (daysPassed < BACKUP_INTERVAL_DAYS || document.getElementById("backup-reminder-banner")) return;

  const ledgerSec = document.getElementById("tab-ledger");
  if (!ledgerSec) return;

  const banner = document.createElement("div");
  banner.id = "backup-reminder-banner";
  banner.className = "glass-card p-3 border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between gap-2 text-xs";
  banner.innerHTML = `
    <div>
      <div class="font-bold text-emerald-400">CSV 定期備份提醒</div>
      <div class="text-slate-300">${lastIso ? `距上次匯出已過 ${daysPassed} 天` : "尚未匯出過 CSV 備份"}，可產出存至雲端硬碟。</div>
    </div>
    <div class="flex gap-1.5 shrink-0">
      <button id="btn-do-periodic-backup" class="px-2.5 py-1.5 rounded-xl btn-soft-accent font-bold">立即產出</button>
      <button id="btn-dismiss-backup" class="px-2 py-1.5 rounded-xl btn-soft-dark">稍後</button>
    </div>
  `;
  ledgerSec.insertBefore(banner, ledgerSec.firstChild);

  document.getElementById("btn-do-periodic-backup").addEventListener("click", () => {
    document.getElementById("btn-export-moze-csv")?.click();
    localStorage.setItem(BACKUP_META_KEY, new Date().toISOString());
    banner.remove();
    window.showToast("已產出 CSV，請選擇存入您的雲端硬碟");
  });
  document.getElementById("btn-dismiss-backup").addEventListener("click", () => banner.remove());
}

function injectStage3Modals() {
  if (document.getElementById("drafts-modal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div id="drafts-modal" role="dialog" aria-modal="true" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="bell-ring" class="w-4 h-4 text-amber-400"></i> iOS 捷徑通知草稿箱</h3>
        <button aria-label="關閉視窗" onclick="document.getElementById('drafts-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-slate-300">
        收到銀行/LINE Pay 通知後會即時出現在此。點擊草稿可標記<b>關鍵字</b>或<b>卡片帳戶</b>建立自動帶入規則，或直接連結既有紀錄避免重複。
      </div>
      <div id="drafts-list" class="space-y-2.5"></div>
      <div id="draft-editor-box" class="hidden p-3 rounded-2xl bg-slate-800/60 border space-y-2.5"></div>
      <div class="pt-2 border-t space-y-1.5">
        <div class="font-bold text-slate-300">已記憶的自動帶入規則 (<span id="rule-count">0</span>)</div>
        <div id="notify-rules-list" class="space-y-1 max-h-36 overflow-y-auto"></div>
      </div>
    </div>
  </div>

  <div id="csv-modal" role="dialog" aria-modal="true" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i> MOZE 4.0 CSV 轉移與備份</h3>
        <button aria-label="關閉視窗" onclick="document.getElementById('csv-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="p-3 rounded-2xl bg-slate-800/50 border space-y-2">
        <div class="font-bold text-emerald-400">一、匯出標準 MOZE 4.0 格式 CSV</div>
        <p class="text-slate-400">產出標準 16 欄位 UTF-8 CSV 檔案，可自行存至 Google 雲端硬碟或 iCloud 檔案。</p>
        <button id="btn-export-moze-csv" class="w-full py-2.5 rounded-xl btn-soft-dark font-bold">下載 MOZE 格式 CSV 備份</button>
      </div>

      <div class="p-3 rounded-2xl bg-slate-800/50 border space-y-2.5">
        <div class="font-bold text-cyan-400">二、無痛匯入 MOZE 4.0 歷史 CSV</div>
        <p class="text-slate-400">支援 UTF-8 / Big5 編碼與 16 欄位解析，並可依紀錄計算各帳戶餘額。</p>
        <input type="file" id="inp-moze-csv" accept=".csv,text/csv" class="w-full p-2">
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-import-tx" checked> <span>寫入交易明細至 Firestore（最多近期 1,500 筆）</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-auto-cat" checked> <span>自動建立 CSV 中尚未存在的主類別與子類別</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-recalc-bal" checked> <span>依全部紀錄加總（含初始金額）更新當月帳戶餘額</span></label>
        </div>
        <div id="csv-preview-box" class="hidden p-2.5 rounded-xl bg-slate-900/60 border space-y-1.5"></div>
        <button id="btn-run-csv-import" disabled class="w-full py-2.5 rounded-xl btn-soft-accent font-bold disabled:opacity-40">請先選擇 MOZE CSV 檔案</button>
      </div>
    </div>
  </div>

  <div id="wizard-modal" role="dialog" aria-modal="true" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="clipboard-check" class="w-4 h-4 text-purple-400"></i> 每月薪資與資產確認精靈</h3>
        <button aria-label="關閉視窗" onclick="document.getElementById('wizard-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div id="wizard-body" class="space-y-3"></div>
    </div>
  </div>
  `;
  document.body.appendChild(wrap);
  bindCsvEvents();
}

async function loadNotifyRules(uid) {
  const snap = await getDoc(doc(db, "users", uid, "settings", "preferences"));
  if (snap.exists() && Array.isArray(snap.data().notifyRules)) {
    notifyRules = snap.data().notifyRules;
  }
}

async function saveNotifyRules(uid) {
  await setDoc(doc(db, "users", uid, "settings", "preferences"), { notifyRules }, { merge: true });
}

function startDraftsListener(uid) {
  if (unsubDrafts) unsubDrafts();
  const q = query(collection(db, "users", uid, "drafts"), where("status", "==", "pending"));
  unsubDrafts = onSnapshot(q, (snap) => {
    pendingDrafts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const badge = document.getElementById("draft-badge");
    if (badge) {
      badge.textContent = String(pendingDrafts.length);
      badge.classList.toggle("hidden", pendingDrafts.length === 0);
    }
  });
}

function matchDraftRule(rawText) {
  let matchedRule = null;
  let matchedAccRule = null;
  for (const r of notifyRules) {
    if (r.keyword && rawText.includes(r.keyword)) matchedRule = r;
    if (r.accountMatch && rawText.includes(r.accountMatch)) matchedAccRule = r;
  }
  return {
    account: matchedAccRule?.targetAccount || matchedRule?.targetAccount || "現金",
    mainCat: matchedRule?.mainCat || "飲食",
    subCat: matchedRule?.subCat || "午餐",
    name: matchedRule?.name || matchedRule?.keyword || "",
    keyword: matchedRule?.keyword || "",
    accountMatch: matchedAccRule?.accountMatch || ""
  };
}

function renderDraftsModal() {
  const listEl = document.getElementById("drafts-list");
  document.getElementById("draft-editor-box").classList.add("hidden");

  if (!pendingDrafts.length) {
    listEl.innerHTML = `<div class="text-center text-slate-400 py-5">目前沒有待處理的 iOS 捷徑通知草稿</div>`;
  } else {
    listEl.innerHTML = pendingDrafts.map(d => {
      const sug = matchDraftRule(d.rawText || "");
      return `
      <div class="p-2.5 rounded-2xl bg-slate-800/50 border space-y-1.5">
        <div class="flex justify-between items-start gap-2">
          <div class="font-medium text-slate-200 leading-relaxed">${escHtml(d.rawText)}</div>
          <span class="font-extrabold text-amber-400 shrink-0">NT$ ${Number(d.parsedAmount || 0).toLocaleString()}</span>
        </div>
        <div class="text-[11px] text-slate-400 flex flex-wrap justify-between items-center gap-1">
          <span>${escHtml(d.parsedDate || "")} ${escHtml(d.parsedTime || "")} · 帶入：${escHtml(sug.account)} / ${escHtml(sug.mainCat)}-${escHtml(sug.subCat)}</span>
          <div class="flex gap-1.5">
            <button data-did="${d.id}" class="btn-edit-draft px-2 py-0.5 rounded btn-soft-dark font-semibold">標記/入帳</button>
            <button data-did="${d.id}" class="btn-del-draft px-2 py-0.5 rounded btn-soft-dark text-rose-300">刪除</button>
          </div>
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll(".btn-edit-draft").forEach(b => b.addEventListener("click", () => openDraftEditor(b.dataset.did)));
    listEl.querySelectorAll(".btn-del-draft").forEach(b => b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "users", auth.currentUser.uid, "drafts", b.dataset.did));
      renderDraftsModal(); window.showToast("已刪除草稿");
    }));
  }

  document.getElementById("rule-count").textContent = String(notifyRules.length);
  const rList = document.getElementById("notify-rules-list");
  rList.innerHTML = notifyRules.map((r, idx) => `
    <div class="flex justify-between items-center py-1 px-2 rounded bg-slate-800/40 text-[11px]">
      <span>關鍵字: <b>${escHtml(r.keyword || "無")}</b> | 卡片字樣: <b>${escHtml(r.accountMatch || "無")}</b> → ${escHtml(r.targetAccount)} (${escHtml(r.mainCat)}/${escHtml(r.subCat)})</span>
      <button data-ridx="${idx}" class="btn-del-rule text-rose-400">移除</button>
    </div>`).join("") || `<div class="text-slate-400">尚無規則，點擊上方草稿「標記/入帳」後會自動記住。</div>`;

  rList.querySelectorAll(".btn-del-rule").forEach(b => b.addEventListener("click", async () => {
    notifyRules.splice(parseInt(b.dataset.ridx, 10), 1);
    await saveNotifyRules(auth.currentUser.uid); renderDraftsModal();
  }));
}

function openDraftEditor(draftId) {
  const draft = pendingDrafts.find(d => d.id === draftId);
  if (!draft) return;
  const state = window.__FINANCE_APP__.getState();
  const sug = matchDraftRule(draft.rawText || "");
  const accs = (state.globalData?.assets?.accounts || []).map(a => a.name);
  if (!accs.includes("現金")) accs.unshift("現金");
  const mains = Object.keys(state.categories || {});
  const candidates = (state.personalTx || []).slice(0, 40);

  const box = document.getElementById("draft-editor-box");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="font-bold text-cyan-400">標記通知文字並確認入帳</div>
    <div class="p-2 rounded-xl bg-slate-900/60 border text-slate-100 select-text leading-relaxed">${escHtml(draft.rawText)}</div>
    <div class="flex gap-1.5">
      <button id="btn-pick-kw" class="px-2.5 py-1 rounded-lg btn-soft-dark">反白設為「關鍵字」</button>
      <button id="btn-pick-acc" class="px-2.5 py-1 rounded-lg btn-soft-dark">反白設為「帳戶辨識」</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div><span class="text-slate-400">關鍵字</span><input type="text" id="ed-kw" value="${escHtml(sug.keyword)}" class="w-full p-1.5 mt-0.5"></div>
      <div><span class="text-slate-400">帳戶辨識字</span><input type="text" id="ed-acc-match" value="${escHtml(sug.accountMatch)}" class="w-full p-1.5 mt-0.5"></div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <div><span class="text-slate-400">金額</span><input type="number" inputmode="decimal" id="ed-amt" value="${draft.parsedAmount || 0}" class="w-full p-1.5 mt-0.5 font-bold"></div>
      <div><span class="text-slate-400">對應帳戶</span><select id="ed-acc" class="w-full p-1.5 mt-0.5">${accs.map(a => `<option value="${escHtml(a)}" ${a === sug.account ? "selected" : ""}>${escHtml(a)}</option>`).join("")}</select></div>
      <div><span class="text-slate-400">名稱</span><input type="text" id="ed-name" value="${escHtml(sug.name)}" class="w-full p-1.5 mt-0.5"></div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div><span class="text-slate-400">主類別</span><select id="ed-main" class="w-full p-1.5 mt-0.5">${mains.map(m => `<option value="${escHtml(m)}" ${m === sug.mainCat ? "selected" : ""}>${escHtml(m)}</option>`).join("")}</select></div>
      <div><span class="text-slate-400">子類別</span><select id="ed-sub" class="w-full p-1.5 mt-0.5"></select></div>
    </div>
    <button id="btn-confirm-draft-tx" class="w-full py-2 rounded-xl btn-soft-accent font-bold">確認新增記帳並記憶規則</button>
    <div class="pt-2 border-t space-y-1.5">
      <div class="text-slate-400">已手動記過？連結既有紀錄消除草稿：</div>
      <div class="flex gap-1.5">
        <select id="ed-link-tx" class="flex-1 p-1.5">
          <option value="">選擇既有紀錄...</option>
          ${candidates.map(c => `<option value="${c.id}">${escHtml(c.date)} · ${escHtml(c.name || c.subCat)} · $${Math.abs(c.amount)} (${escHtml(c.account)})</option>`).join("")}
        </select>
        <button id="btn-link-draft-tx" class="px-3 py-1.5 rounded-xl btn-soft-dark font-semibold">連結消除</button>
      </div>
    </div>
  `;

  const mainSel = document.getElementById("ed-main");
  const subSel = document.getElementById("ed-sub");
  const syncSubs = () => {
    const list = state.categories[mainSel.value] || ["一般"];
    subSel.innerHTML = list.map(s => `<option value="${escHtml(s)}" ${s === sug.subCat ? "selected" : ""}>${escHtml(s)}</option>`).join("");
  };
  mainSel.onchange = syncSubs; syncSubs();

  const grabSelection = () => window.getSelection()?.toString()?.trim() || "";
  document.getElementById("btn-pick-kw").onclick = () => {
    const sel = grabSelection();
    if (!sel) return alert("請先反白選取通知裡的關鍵字");
    document.getElementById("ed-kw").value = sel;
    if (!document.getElementById("ed-name").value) document.getElementById("ed-name").value = sel;
  };
  document.getElementById("btn-pick-acc").onclick = () => {
    const sel = grabSelection();
    if (!sel) return alert("請先反白選取通知裡的銀行或卡號");
    document.getElementById("ed-acc-match").value = sel;
  };

  document.getElementById("btn-confirm-draft-tx").onclick = async () => {
    const uid = auth.currentUser.uid;
    const kw = document.getElementById("ed-kw").value.trim();
    const accMatch = document.getElementById("ed-acc-match").value.trim();
    const targetAccount = document.getElementById("ed-acc").value;
    const mainCat = mainSel.value; const subCat = subSel.value;
    const name = document.getElementById("ed-name").value.trim() || kw || subCat;
    const amount = parseFloat(document.getElementById("ed-amt").value) || 0;
    const now = new Date();
    const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const txRef = await addDoc(collection(db, "users", uid, "transactions"), {
      type: "支出", account: targetAccount, currency: "TWD", amount, fee: 0, discount: 0,
      mainCat, subCat, name, merchant: kw,
      date: draft.parsedDate || isoDate,
      time: draft.parsedTime || "12:00", ts: Date.now(),
      note: "由 iOS 捷徑通知草稿轉入", updatedAt: now.toISOString()
    });
    if (kw || accMatch) {
      notifyRules = notifyRules.filter(r => !(r.keyword === kw && r.accountMatch === accMatch));
      notifyRules.unshift({ keyword: kw, accountMatch: accMatch, targetAccount, mainCat, subCat, name });
      await saveNotifyRules(uid);
    }
    await updateDoc(doc(db, "users", uid, "drafts", draft.id), { status: "confirmed", linkedTxId: txRef.id });
    renderDraftsModal(); window.showToast("已確認入帳並記憶規則");
  };

  document.getElementById("btn-link-draft-tx").onclick = async () => {
    const linkedId = document.getElementById("ed-link-tx").value;
    if (!linkedId) return alert("請先選擇要連結的既有紀錄");
    await updateDoc(doc(db, "users", auth.currentUser.uid, "drafts", draft.id), { status: "linked", linkedTxId: linkedId });
    renderDraftsModal(); window.showToast("已連結既有紀錄並消除草稿");
  };
}

let parsedCsvRecords = [];
function bindCsvEvents() {
  document.getElementById("btn-export-moze-csv").addEventListener("click", () => {
    const state = window.__FINANCE_APP__.getState();
    const list = state.activeBookId === "personal" ? state.personalTx : state.sharedTx;
    const headers = ["帳戶", "幣種", "記錄類型", "主類別", "子類別", "金額", "手續費", "折扣", "名稱", "商家", "日期", "時間", "專案", "描述", "標籤", "對象"];
    const rows = [headers.join(",")];
    list.forEach(tx => {
      const isNeg = (tx.type === "支出" || tx.type === "轉出" || tx.type === "應付款項");
      const signedAmt = isNeg ? -Math.abs(Number(tx.amount || 0)) : Math.abs(Number(tx.amount || 0));
      const cols = [
        tx.account || "", tx.currency || "TWD", tx.type || "支出", tx.mainCat || "", tx.subCat || "", signedAmt,
        tx.fee || 0, tx.discount || 0, tx.name || "", tx.merchant || "", tx.date || "", tx.time || "09:00",
        tx.project || "", tx.note || "", tx.tags || "", tx.counterparty || ""
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      rows.push(cols.join(","));
    });
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `MOZE_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    localStorage.setItem(BACKUP_META_KEY, new Date().toISOString());
    window.showToast("已產出 MOZE 格式 CSV 備份");
  });

  document.getElementById("inp-moze-csv").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (!text.includes("帳戶")) { try { text = new TextDecoder("big5").decode(buf); } catch (err) {} }
    const rows = parseCsvRows(text);
    const h = rows[0] || [];
    const idx = {
      acc: h.indexOf("帳戶"), cur: h.indexOf("幣種"), type: h.indexOf("記錄類型"),
      main: h.indexOf("主類別"), sub: h.indexOf("子類別"), amt: h.indexOf("金額"),
      fee: h.indexOf("手續費"), disc: h.indexOf("折扣"), name: h.indexOf("名稱"),
      merch: h.indexOf("商家"), date: h.indexOf("日期"), time: h.indexOf("時間"),
      proj: h.indexOf("專案"), note: h.indexOf("描述"), tags: h.indexOf("標籤"), obj: h.indexOf("對象")
    };
    if (idx.acc < 0 || idx.amt < 0) return alert("找不到 MOZE CSV 的「帳戶」或「金額」欄位");

    parsedCsvRecords = [];
    const accBalances = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r[idx.acc]) continue;
      const amt = parseFloat(r[idx.amt]) || 0;
      const fee = idx.fee >= 0 ? (parseFloat(r[idx.fee]) || 0) : 0;
      const disc = idx.disc >= 0 ? (parseFloat(r[idx.disc]) || 0) : 0;
      const rawDate = idx.date >= 0 ? (r[idx.date] || "").trim() : "";
      const dParts = rawDate.replace(/\//g, "-").split("-");
      const dateStr = dParts.length === 3 ? `${dParts[0]}-${dParts[1].padStart(2, "0")}-${dParts[2].padStart(2, "0")}` : rawDate;
      const timeStr = idx.time >= 0 ? (r[idx.time] || "").trim() : "09:00";
      const parsedTs = Date.parse(`${dateStr.replace(/-/g, "/")} ${timeStr}`) || Date.now();
      parsedCsvRecords.push({
        account: r[idx.acc].trim(), currency: (idx.cur >= 0 && r[idx.cur]) ? r[idx.cur].trim() : "TWD",
        type: (idx.type >= 0 && r[idx.type]) ? r[idx.type].trim() : "支出",
        mainCat: idx.main >= 0 ? (r[idx.main] || "").trim() : "其他",
        subCat: idx.sub >= 0 ? (r[idx.sub] || "").trim() : "一般",
        amount: Math.abs(amt), fee, discount: disc,
        name: idx.name >= 0 ? (r[idx.name] || "").trim() : "",
        merchant: idx.merch >= 0 ? (r[idx.merch] || "").trim() : "",
        date: dateStr, time: timeStr, ts: parsedTs,
        project: idx.proj >= 0 ? (r[idx.proj] || "").trim() : "",
        note: idx.note >= 0 ? (r[idx.note] || "").trim() : "",
        tags: idx.tags >= 0 ? (r[idx.tags] || "").trim() : "",
        counterparty: idx.obj >= 0 ? (r[idx.obj] || "").trim() : ""
      });
      accBalances[r[idx.acc].trim()] = (accBalances[r[idx.acc].trim()] || 0) + amt + fee + disc;
    }

    const box = document.getElementById("csv-preview-box");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="font-bold">解析完成：共 ${parsedCsvRecords.length} 筆，涵蓋 ${Object.keys(accBalances).length} 個帳戶</div><div class="max-h-28 overflow-y-auto text-[11px] text-slate-400 space-y-0.5">${Object.entries(accBalances).map(([k, v]) => `<div>• ${escHtml(k)}：累計 <b>${Math.round(v).toLocaleString()}</b></div>`).join("")}</div>`;
    const btn = document.getElementById("btn-run-csv-import");
    btn.disabled = parsedCsvRecords.length === 0;
    btn.textContent = `開始匯入 (${parsedCsvRecords.length} 筆)`;
    btn.dataset.balances = JSON.stringify(accBalances);
  });

  document.getElementById("btn-run-csv-import").addEventListener("click", async () => {
    if (!parsedCsvRecords.length) return;
    const btn = document.getElementById("btn-run-csv-import");
    btn.disabled = true; btn.textContent = "匯入中...";
    const uid = auth.currentUser.uid;
    const state = window.__FINANCE_APP__.getState();
    const accBalances = JSON.parse(btn.dataset.balances || "{}");

    if (document.getElementById("chk-csv-auto-cat").checked) {
      const cats = state.categories;
      parsedCsvRecords.forEach(r => {
        if (r.type === "初始金額" || r.type === "餘額調整") return;
        if (r.mainCat) {
          if (!cats[r.mainCat]) cats[r.mainCat] = [];
          if (r.subCat && !cats[r.mainCat].includes(r.subCat)) cats[r.mainCat].push(r.subCat);
        }
      });
      await setDoc(doc(db, "users", uid, "settings", "preferences"), { categories: cats }, { merge: true });
    }

    if (document.getElementById("chk-csv-import-tx").checked) {
      const txToWrite = parsedCsvRecords.filter(r => r.type !== "初始金額").slice(-1500);
      for (let i = 0; i < txToWrite.length; i += 400) {
        const batch = writeBatch(db);
        txToWrite.slice(i, i + 400).forEach(item => {
          batch.set(doc(collection(db, "users", uid, "transactions")), { ...item, updatedAt: new Date().toISOString() });
        });
        await batch.commit();
      }
    }

    if (document.getElementById("chk-csv-recalc-bal").checked && state.globalData?.assets?.accounts) {
      const mIdx = parseInt(document.getElementById("select-month").value || "0", 10);
      state.globalData.assets.accounts.forEach(acc => {
        if (accBalances[acc.name] !== undefined) acc.values[mIdx] = Math.round(accBalances[acc.name]);
      });
      await setDoc(doc(db, "users", uid, "overview", "latest"), state.globalData, { merge: true });
    }

    window.__FINANCE_APP__.refreshView();
    document.getElementById("csv-modal").classList.add("hidden");
    window.showToast("MOZE CSV 匯入完成！");
  });
}

function parseCsvRows(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function openSettlementWizard() {
  const state = window.__FINANCE_APP__.getState();
  const sel = document.getElementById("select-month");
  const mIdx = parseInt(sel.value || "0", 10);
  const monthStr = sel.options[sel.selectedIndex]?.text || "當月";
  const s = state.globalData?.salary || {};
  const totalSal = Math.round(s.totalSalary?.[mIdx] || 0);
  const mort = Math.round(s.mortgage?.[mIdx] || 11168);
  const luna = Math.round(s.luna?.[mIdx] || 3000);
  const inv = Math.round(s.investment?.[mIdx] || s.investCost?.[mIdx] || 0);

  document.getElementById("wizard-body").innerHTML = `
    <div class="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 space-y-1.5">
      <div class="font-bold text-purple-400">步驟 1：確認 ${escHtml(monthStr)} 薪資入帳與固定轉帳</div>
      <div>• 實發總薪資：<b>NT$ ${totalSal.toLocaleString()}</b></div>
      <div>• 房貸固定扣款：<b>NT$ ${mort.toLocaleString()}</b></div>
      <div>• 嚕哪寵物基金：<b>NT$ ${luna.toLocaleString()}</b></div>
      <div>• 投資預算/成本：<b>NT$ ${inv.toLocaleString()}</b></div>
      <div class="grid grid-cols-2 gap-2 pt-1">
        <div><span class="text-slate-400">薪資入帳帳戶</span><input type="text" id="wiz-sal-acc" value="台新薪轉戶" class="w-full p-1.5 mt-0.5"></div>
        <div class="flex items-end"><label class="flex items-center gap-1.5 pb-1.5"><input type="checkbox" id="wiz-gen-tx" checked> <span>產生本月固定流水（防重複）</span></label></div>
      </div>
    </div>
    <button id="btn-run-wizard" class="w-full py-3 rounded-2xl btn-soft-accent font-bold">確認完成 ${escHtml(monthStr)} 月結</button>
  `;
  document.getElementById("wizard-modal").classList.remove("hidden");

  document.getElementById("btn-run-wizard").onclick = async () => {
    const uid = auth.currentUser.uid;
    const salAcc = document.getElementById("wiz-sal-acc").value.trim() || "台新薪轉戶";
    const genTx = document.getElementById("wiz-gen-tx").checked;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const marker = `[月結:${monthStr}]`;

    if (genTx) {
      const exists = (state.personalTx || []).some(t => String(t.note || "").includes(marker));
      if (!exists) {
        if (totalSal > 0) await addDoc(collection(db, "users", uid, "transactions"), { type: "收入", account: salAcc, currency: "TWD", amount: totalSal, mainCat: "其他", subCat: "薪水", name: `${monthStr} 實發薪資`, note: marker, date: todayStr, time: "09:00", ts: Date.now(), updatedAt: now.toISOString() });
        if (mort > 0) await addDoc(collection(db, "users", uid, "transactions"), { type: "轉帳", account: salAcc, toAccount: "彰化銀行(房貸)", currency: "TWD", amount: mort, mainCat: "家居", subCat: "房租/房貸", name: `${monthStr} 房貸轉帳`, note: marker, date: todayStr, time: "09:05", ts: Date.now() + 1, updatedAt: now.toISOString() });
        if (luna > 0) await addDoc(collection(db, "users", uid, "transactions"), { type: "轉帳", account: salAcc, toAccount: "國泰嚕哪基金", currency: "TWD", amount: luna, mainCat: "貓咪", subCat: "嚕哪飼料/罐頭", name: `${monthStr} 嚕哪每月基金`, note: marker, date: todayStr, time: "09:10", ts: Date.now() + 2, updatedAt: now.toISOString() });
      } else {
        window.showToast(`${monthStr} 固定流水已存在，略過重複產生`);
      }
    }
    window.__FINANCE_APP__.refreshView();
    document.getElementById("wizard-modal").classList.add("hidden");
    if (state.userProfile?.gasUrl) document.getElementById("btn-sync-sheet")?.click();
    window.showToast(`${monthStr} 月結確認完成`);
  };
}

function escHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}