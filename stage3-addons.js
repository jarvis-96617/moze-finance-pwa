import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, writeBatch, orderBy
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const app = getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

let notifyRules = []; // [{ keyword, accountMatch, targetAccount, mainCat, subCat, project, name, tags }]
let pendingDrafts = [];
let unsubDrafts = null;

// 等待主程式登入載入完成後掛載第三階段 UI 與監聽
const bootTimer = setInterval(() => {
  const api = window.__FINANCE_APP__;
  const state = api?.getState?.();
  if (state && state.currentUser && document.querySelector("header .flex.items-center.gap-1.shrink-0")) {
    clearInterval(bootTimer);
    initStage3(state.currentUser);
  }
}, 400);

async function initStage3(user) {
  injectHeaderButtons();
  injectStage3Modals();
  await loadNotifyRules(user.uid);
  startDraftsListener(user.uid);
}

// =========================================================================
// 1. 在頂部 Header 注入三顆按鈕：通知草稿、MOZE CSV、月結確認
// =========================================================================
function injectHeaderButtons() {
  const bar = document.querySelector("header .flex.items-center.gap-1.shrink-0");
  if (!bar || document.getElementById("btn-open-drafts")) return;

  const btnDraft = document.createElement("button");
  btnDraft.id = "btn-open-drafts";
  btnDraft.className = "relative p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-amber-400 border";
  btnDraft.title = "iOS 捷徑通知草稿";
  btnDraft.innerHTML = `<i data-lucide="bell" class="w-3.5 h-3.5"></i><span id="draft-badge" class="hidden absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">0</span>`;

  const btnCsv = document.createElement("button");
  btnCsv.id = "btn-open-csv";
  btnCsv.className = "p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-emerald-400 border";
  btnCsv.title = "MOZE 4.0 CSV 匯入 / 匯出";
  btnCsv.innerHTML = `<i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>`;

  const btnCloseMonth = document.createElement("button");
  btnCloseMonth.id = "btn-open-wizard";
  btnCloseMonth.className = "p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-purple-400 border";
  btnCloseMonth.title = "每月薪資與資產確認精靈";
  btnCloseMonth.innerHTML = `<i data-lucide="clipboard-check" class="w-3.5 h-3.5"></i>`;

  bar.insertBefore(btnCloseMonth, bar.firstChild);
  bar.insertBefore(btnCsv, bar.firstChild);
  bar.insertBefore(btnDraft, bar.firstChild);
  if (window.lucide) window.lucide.createIcons();

  btnDraft.addEventListener("click", () => {
    renderDraftsModal();
    document.getElementById("drafts-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  });
  btnCsv.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  });
  btnCloseMonth.addEventListener("click", () => {
    openSettlementWizard();
  });
}

function injectStage3Modals() {
  if (document.getElementById("drafts-modal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <!-- 彈窗 1：iOS 捷徑通知草稿與規則標記 -->
  <div id="drafts-modal" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="bell-ring" class="w-4 h-4 text-amber-400"></i> iOS 捷徑通知草稿箱</h3>
        <button onclick="document.getElementById('drafts-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
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

  <!-- 彈窗 2：MOZE 4.0 CSV 完整匯入與匯出 -->
  <div id="csv-modal" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i> MOZE 4.0 CSV 轉移與備份</h3>
        <button onclick="document.getElementById('csv-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="p-3 rounded-2xl bg-slate-800/50 border space-y-2">
        <div class="font-bold text-emerald-400">一、匯出標準 MOZE 4.0 格式 CSV</div>
        <p class="text-slate-400">將目前所選帳本的紀錄匯出為完全相容 MOZE 4.0 的 16 欄位 UTF-8 CSV 檔案。</p>
        <button id="btn-export-moze-csv" class="w-full py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">下載 MOZE 格式 CSV 備份</button>
      </div>

      <div class="p-3 rounded-2xl bg-slate-800/50 border space-y-2.5">
        <div class="font-bold text-cyan-400">二、無痛匯入 MOZE 4.0 歷史 CSV</div>
        <p class="text-slate-400">支援 UTF-8 / Big5 編碼與 16 欄位解析。可選擇匯入歷史明細，並依「初始金額」自動重算各帳戶最新餘額。</p>
        <input type="file" id="inp-moze-csv" accept=".csv,text/csv" class="w-full p-2 border">
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-import-tx" checked> <span>寫入交易明細至 Firestore（最多近期 1,500 筆，避免超出免費額度）</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-auto-cat" checked> <span>自動建立 CSV 中尚未存在的主類別與子類別</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" id="chk-csv-recalc-bal" checked> <span>依全部紀錄加總（含初始金額）更新當月帳戶餘額</span></label>
        </div>
        <div id="csv-preview-box" class="hidden p-2.5 rounded-xl bg-slate-900/60 border space-y-1.5"></div>
        <button id="btn-run-csv-import" disabled class="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold disabled:opacity-40">請先選擇 MOZE CSV 檔案</button>
      </div>
    </div>
  </div>

  <!-- 彈窗 3：每月薪資與資產確認結算精靈 -->
  <div id="wizard-modal" class="hidden fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="modal-sheet w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs">
      <div class="flex justify-between items-center border-b pb-2.5">
        <h3 class="text-base font-bold flex items-center gap-1.5"><i data-lucide="clipboard-check" class="w-4 h-4 text-purple-400"></i> 每月薪資與資產確認精靈</h3>
        <button onclick="document.getElementById('wizard-modal').classList.add('hidden')" class="text-slate-400 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div id="wizard-body" class="space-y-3"></div>
    </div>
  </div>
  `;
  document.body.appendChild(wrap);
  bindCsvEvents();
}

// =========================================================================
// 2. iOS 捷徑通知草稿監聽 + 關鍵字/帳戶標記規則引擎 + 防重複連結
// =========================================================================
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
    project: matchedRule?.project || "",
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
        <div class="text-[10px] text-slate-400 flex flex-wrap justify-between items-center gap-1">
          <span>${d.parsedDate || ""} ${d.parsedTime || ""} · 帶入：${sug.account} / ${sug.mainCat}-${sug.subCat}</span>
          <div class="flex gap-1.5">
            <button data-did="${d.id}" class="btn-edit-draft px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-semibold">標記/入帳</button>
            <button data-did="${d.id}" class="btn-del-draft px-2 py-0.5 rounded bg-rose-500/20 text-rose-400">刪除</button>
          </div>
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll(".btn-edit-draft").forEach(b => {
      b.addEventListener("click", () => openDraftEditor(b.dataset.did));
    });
    listEl.querySelectorAll(".btn-del-draft").forEach(b => {
      b.addEventListener("click", async () => {
        const uid = auth.currentUser.uid;
        await deleteDoc(doc(db, "users", uid, "drafts", b.dataset.did));
        renderDraftsModal();
        window.showToast("已刪除草稿");
      });
    });
  }

  // 渲染已記憶規則
  document.getElementById("rule-count").textContent = String(notifyRules.length);
  const rList = document.getElementById("notify-rules-list");
  rList.innerHTML = notifyRules.map((r, idx) => `
    <div class="flex justify-between items-center py-1 px-2 rounded bg-slate-800/40 text-[11px]">
      <span>關鍵字: <b>${escHtml(r.keyword || "無")}</b> | 卡片字樣: <b>${escHtml(r.accountMatch || "無")}</b> → ${escHtml(r.targetAccount)} (${escHtml(r.mainCat)}/${escHtml(r.subCat)})</span>
      <button data-ridx="${idx}" class="btn-del-rule text-rose-400">移除</button>
    </div>`).join("") || `<div class="text-slate-400">尚無規則，點擊上方草稿「標記/入帳」後會自動記住。</div>`;

  rList.querySelectorAll(".btn-del-rule").forEach(b => {
    b.addEventListener("click", async () => {
      notifyRules.splice(parseInt(b.dataset.ridx, 10), 1);
      await saveNotifyRules(auth.currentUser.uid);
      renderDraftsModal();
    });
  });
}

function openDraftEditor(draftId) {
  const draft = pendingDrafts.find(d => d.id === draftId);
  if (!draft) return;
  const state = window.__FINANCE_APP__.getState();
  const sug = matchDraftRule(draft.rawText || "");
  const accs = (state.globalData?.assets?.accounts || []).map(a => a.name);
  if (!accs.includes("現金")) accs.unshift("現金");
  const mains = Object.keys(state.categories || {});

  // 找出日期相近或金額相同的既有交易供「連結既有記錄」
  const candidates = (state.personalTx || []).slice(0, 40);

  const box = document.getElementById("draft-editor-box");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="font-bold text-cyan-400">標記通知文字並確認入帳</div>
    <div id="draft-selectable-text" class="p-2 rounded-xl bg-slate-900/80 border text-slate-100 select-text leading-relaxed">${escHtml(draft.rawText)}</div>
    <div class="flex gap-1.5">
      <button id="btn-pick-kw" class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">將反白文字設為「關鍵字」</button>
      <button id="btn-pick-acc" class="px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">將反白文字設為「帳戶辨識」</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div><span class="text-slate-400">關鍵字（商家/變動字）</span><input type="text" id="ed-kw" value="${escHtml(sug.keyword)}" class="w-full p-1.5 mt-0.5 border" placeholder="如：全家便利商店"></div>
      <div><span class="text-slate-400">帳戶辨識字（卡名/末四碼）</span><input type="text" id="ed-acc-match" value="${escHtml(sug.accountMatch)}" class="w-full p-1.5 mt-0.5 border" placeholder="如：玉山銀行"></div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <div><span class="text-slate-400">金額</span><input type="number" id="ed-amt" value="${draft.parsedAmount || 0}" class="w-full p-1.5 mt-0.5 border font-bold"></div>
      <div><span class="text-slate-400">對應帳戶</span><select id="ed-acc" class="w-full p-1.5 mt-0.5 border">${accs.map(a => `<option value="${escHtml(a)}" ${a === sug.account ? "selected" : ""}>${escHtml(a)}</option>`).join("")}</select></div>
      <div><span class="text-slate-400">名稱</span><input type="text" id="ed-name" value="${escHtml(sug.name)}" class="w-full p-1.5 mt-0.5 border"></div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div><span class="text-slate-400">主類別</span><select id="ed-main" class="w-full p-1.5 mt-0.5 border">${mains.map(m => `<option value="${escHtml(m)}" ${m === sug.mainCat ? "selected" : ""}>${escHtml(m)}</option>`).join("")}</select></div>
      <div><span class="text-slate-400">子類別</span><select id="ed-sub" class="w-full p-1.5 mt-0.5 border"></select></div>
    </div>
    <div class="flex gap-2 pt-1">
      <button id="btn-confirm-draft-tx" class="flex-1 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold">確認新增記帳並記憶規則</button>
    </div>
    <div class="pt-2 border-t space-y-1.5">
      <div class="text-slate-400">若此筆已手動或發票記過，可「連結既有記錄」消除草稿（不重複入帳）：</div>
      <div class="flex gap-1.5">
        <select id="ed-link-tx" class="flex-1 p-1.5 border">
          <option value="">選擇既有紀錄...</option>
          ${candidates.map(c => `<option value="${c.id}">${c.date} · ${c.name || c.subCat} · $${Math.abs(c.amount)} (${c.account})</option>`).join("")}
        </select>
        <button id="btn-link-draft-tx" class="px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">連結消除</button>
      </div>
    </div>
  `;

  const mainSel = document.getElementById("ed-main");
  const subSel = document.getElementById("ed-sub");
  const syncSubs = () => {
    const list = state.categories[mainSel.value] || ["一般"];
    subSel.innerHTML = list.map(s => `<option value="${escHtml(s)}" ${s === sug.subCat ? "selected" : ""}>${escHtml(s)}</option>`).join("");
  };
  mainSel.onchange = syncSubs;
  syncSubs();

  const grabSelection = () => window.getSelection()?.toString()?.trim() || "";
  document.getElementById("btn-pick-kw").onclick = () => {
    const sel = grabSelection();
    if (!sel) return alert("請先用滑鼠或手指反白選取上方通知裡的商家/關鍵字");
    document.getElementById("ed-kw").value = sel;
    if (!document.getElementById("ed-name").value) document.getElementById("ed-name").value = sel;
  };
  document.getElementById("btn-pick-acc").onclick = () => {
    const sel = grabSelection();
    if (!sel) return alert("請先反白選取上方通知裡的銀行名稱或卡號末四碼");
    document.getElementById("ed-acc-match").value = sel;
  };

  document.getElementById("btn-confirm-draft-tx").onclick = async () => {
    const uid = auth.currentUser.uid;
    const kw = document.getElementById("ed-kw").value.trim();
    const accMatch = document.getElementById("ed-acc-match").value.trim();
    const targetAccount = document.getElementById("ed-acc").value;
    const mainCat = mainSel.value;
    const subCat = subSel.value;
    const name = document.getElementById("ed-name").value.trim() || kw || subCat;
    const amount = parseFloat(document.getElementById("ed-amt").value) || 0;

    // 寫入正式交易
    const txRef = await addDoc(collection(db, "users", uid, "transactions"), {
      type: "支出",
      account: targetAccount,
      currency: "TWD",
      amount,
      fee: 0,
      discount: 0,
      mainCat,
      subCat,
      name,
      merchant: kw,
      date: draft.parsedDate || new Date().toLocaleDateString("zh-TW"),
      time: draft.parsedTime || "12:00",
      note: "由 iOS 捷徑通知草稿轉入",
      updatedAt: new Date().toISOString()
    });

    // 更新規則庫
    if (kw || accMatch) {
      notifyRules = notifyRules.filter(r => !(r.keyword === kw && r.accountMatch === accMatch));
      notifyRules.unshift({ keyword: kw, accountMatch: accMatch, targetAccount, mainCat, subCat, name });
      await saveNotifyRules(uid);
    }

    await updateDoc(doc(db, "users", uid, "drafts", draft.id), { status: "confirmed", linkedTxId: txRef.id });
    await window.__FINANCE_APP__.reloadAll();
    renderDraftsModal();
    window.showToast("已確認入帳並記憶帶入規則");
  };

  document.getElementById("btn-link-draft-tx").onclick = async () => {
    const linkedId = document.getElementById("ed-link-tx").value;
    if (!linkedId) return alert("請先選擇要連結的既有紀錄");
    const uid = auth.currentUser.uid;
    const kw = document.getElementById("ed-kw").value.trim();
    const accMatch = document.getElementById("ed-acc-match").value.trim();
    if (kw || accMatch) {
      notifyRules.unshift({
        keyword: kw,
        accountMatch: accMatch,
        targetAccount: document.getElementById("ed-acc").value,
        mainCat: mainSel.value,
        subCat: subSel.value,
        name: document.getElementById("ed-name").value.trim()
      });
      await saveNotifyRules(uid);
    }
    await updateDoc(doc(db, "users", uid, "drafts", draft.id), { status: "linked", linkedTxId: linkedId });
    renderDraftsModal();
    window.showToast("已連結既有紀錄並消除草稿");
  };
}

// =========================================================================
// 3. MOZE 4.0 16欄位 CSV 完整匯入與匯出引擎
// =========================================================================
let parsedCsvRecords = [];

function bindCsvEvents() {
  // 匯出 MOZE 4.0 CSV
  document.getElementById("btn-export-moze-csv").addEventListener("click", () => {
    const state = window.__FINANCE_APP__.getState();
    const list = state.activeBookId === "personal" ? state.personalTx : state.sharedTx;
    const headers = ["帳戶", "幣種", "記錄類型", "主類別", "子類別", "金額", "手續費", "折扣", "名稱", "商家", "日期", "時間", "專案", "描述", "標籤", "對象"];
    const rows = [headers.join(",")];
    list.forEach(tx => {
      const isNeg = (tx.type === "支出" || tx.type === "轉出" || tx.type === "應付款項");
      const rawAmt = Math.abs(Number(tx.amount || 0));
      const signedAmt = isNeg ? -rawAmt : rawAmt;
      const cols = [
        tx.account || "", tx.currency || "TWD", tx.type || "支出",
        tx.mainCat || "", tx.subCat || "", signedAmt,
        tx.fee || 0, tx.discount || 0, tx.name || "", tx.merchant || "",
        tx.date || "", tx.time || "09:00", tx.project || "",
        tx.note || "", tx.tags || "", tx.counterparty || ""
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      rows.push(cols.join(","));
    });
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `MOZE_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.showToast("已下載 MOZE 4.0 格式 CSV");
  });

  // 讀取並預覽 MOZE CSV
  document.getElementById("inp-moze-csv").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (!text.includes("帳戶")) {
      try { text = new TextDecoder("big5").decode(buf); } catch (err) {}
    }
    const rows = parseCsvRows(text);
    const h = rows[0] || [];
    const idx = {
      acc: h.indexOf("帳戶"), cur: h.indexOf("幣種"), type: h.indexOf("記錄類型"),
      main: h.indexOf("主類別"), sub: h.indexOf("子類別"), amt: h.indexOf("金額"),
      fee: h.indexOf("手續費"), disc: h.indexOf("折扣"), name: h.indexOf("名稱"),
      merch: h.indexOf("商家"), date: h.indexOf("日期"), time: h.indexOf("時間"),
      proj: h.indexOf("專案"), note: h.indexOf("描述"), tags: h.indexOf("標籤"), obj: h.indexOf("對象")
    };
    if (idx.acc < 0 || idx.amt < 0) {
      alert("找不到 MOZE CSV 的「帳戶」或「金額」欄位，請確認檔案格式。");
      return;
    }

    parsedCsvRecords = [];
    const accBalances = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[idx.acc]) continue;
      const amt = parseFloat(r[idx.amt]) || 0;
      const fee = idx.fee >= 0 ? (parseFloat(r[idx.fee]) || 0) : 0;
      const disc = idx.disc >= 0 ? (parseFloat(r[idx.disc]) || 0) : 0;
      const rec = {
        account: r[idx.acc].trim(),
        currency: (idx.cur >= 0 && r[idx.cur]) ? r[idx.cur].trim() : "TWD",
        type: (idx.type >= 0 && r[idx.type]) ? r[idx.type].trim() : "支出",
        mainCat: idx.main >= 0 ? (r[idx.main] || "").trim() : "其他",
        subCat: idx.sub >= 0 ? (r[idx.sub] || "").trim() : "一般",
        amount: Math.abs(amt),
        rawSignedAmount: amt,
        fee,
        discount: disc,
        name: idx.name >= 0 ? (r[idx.name] || "").trim() : "",
        merchant: idx.merch >= 0 ? (r[idx.merch] || "").trim() : "",
        date: idx.date >= 0 ? (r[idx.date] || "").trim() : "",
        time: idx.time >= 0 ? (r[idx.time] || "").trim() : "09:00",
        project: idx.proj >= 0 ? (r[idx.proj] || "").trim() : "",
        note: idx.note >= 0 ? (r[idx.note] || "").trim() : "",
        tags: idx.tags >= 0 ? (r[idx.tags] || "").trim() : "",
        counterparty: idx.obj >= 0 ? (r[idx.obj] || "").trim() : ""
      };
      parsedCsvRecords.push(rec);
      accBalances[rec.account] = (accBalances[rec.account] || 0) + amt + fee + disc;
    }

    const box = document.getElementById("csv-preview-box");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="font-bold text-slate-200">解析完成：共 ${parsedCsvRecords.length} 筆紀錄，涵蓋 ${Object.keys(accBalances).length} 個帳戶</div>
      <div class="max-h-32 overflow-y-auto text-[11px] text-slate-400 space-y-0.5">
        ${Object.entries(accBalances).map(([k, v]) => `<div>• ${escHtml(k)}：累計結餘 <b>${Math.round(v).toLocaleString()}</b></div>`).join("")}
      </div>`;
    const btn = document.getElementById("btn-run-csv-import");
    btn.disabled = parsedCsvRecords.length === 0;
    btn.textContent = `開始匯入 (${parsedCsvRecords.length} 筆)`;
    btn.dataset.balances = JSON.stringify(accBalances);
  });

  // 執行匯入
  document.getElementById("btn-run-csv-import").addEventListener("click", async () => {
    if (!parsedCsvRecords.length) return;
    const btn = document.getElementById("btn-run-csv-import");
    btn.disabled = true;
    btn.textContent = "匯入處理中...";

    const uid = auth.currentUser.uid;
    const state = window.__FINANCE_APP__.getState();
    const doTx = document.getElementById("chk-csv-import-tx").checked;
    const doCat = document.getElementById("chk-csv-auto-cat").checked;
    const doBal = document.getElementById("chk-csv-recalc-bal").checked;
    const accBalances = JSON.parse(btn.dataset.balances || "{}");

    // 1. 自動補齊分類
    if (doCat) {
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

    // 2. 批量寫入明細（排除純「初始金額」列，取最新 1500 筆）
    if (doTx) {
      const txToWrite = parsedCsvRecords.filter(r => r.type !== "初始金額").slice(-1500);
      for (let i = 0; i < txToWrite.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = txToWrite.slice(i, i + 400);
        chunk.forEach(item => {
          const ref = doc(collection(db, "users", uid, "transactions"));
          const cleanItem = { ...item, updatedAt: new Date().toISOString() };
          delete cleanItem.rawSignedAmount;
          batch.set(ref, cleanItem);
        });
        await batch.commit();
      }
    }

    // 3. 更新當月帳戶餘額快照
    if (doBal && state.globalData?.assets?.accounts) {
      const mIdx = parseInt(document.getElementById("select-month").value || "0", 10);
      state.globalData.assets.accounts.forEach(acc => {
        if (accBalances[acc.name] !== undefined) {
          acc.values[mIdx] = Math.round(accBalances[acc.name]);
        }
      });
      await setDoc(doc(db, "users", uid, "overview", "latest"), state.globalData, { merge: true });
    }

    await window.__FINANCE_APP__.reloadAll();
    document.getElementById("csv-modal").classList.add("hidden");
    window.showToast("MOZE CSV 匯入完成！");
  });
}

function parseCsvRows(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// =========================================================================
// 4. 每月薪資與資產確認結算精靈（一鍵串接記帳 + 資產快照 + Google Sheet）
// =========================================================================
function openSettlementWizard() {
  const state = window.__FINANCE_APP__.getState();
  const sel = document.getElementById("select-month");
  const mIdx = parseInt(sel.value || "0", 10);
  const monthStr = sel.options[sel.selectedIndex]?.text || "當月";
  const s = state.globalData?.salary || {};

  const totalSal = Math.round(s.totalSalary?.[mIdx] || 0);
  const mort = Math.round(s.mortgage?.[mIdx] || 11168);
  const luna = Math.round(s.luna?.[mIdx] || 3000);
  const inv = Math.round(s.investment?.[mIdx] || 0);

  const body = document.getElementById("wizard-body");
  body.innerHTML = `
    <div class="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 space-y-2">
      <div class="font-bold text-purple-400">步驟 1：確認 ${monthStr} 薪資入帳與固定轉帳</div>
      <div class="text-slate-300 space-y-1">
        <div>• 實發總薪資：<b>NT$ ${totalSal.toLocaleString()}</b>（將寫入「收入 - 薪水」）</div>
        <div>• 房貸固定扣款：<b>NT$ ${mort.toLocaleString()}</b>（寫入「轉出 → 彰化銀行(房貸)」）</div>
        <div>• 嚕哪寵物基金：<b>NT$ ${luna.toLocaleString()}</b>（寫入「轉出 → 國泰嚕哪基金」）</div>
        <div>• 定期投資扣款：<b>NT$ ${inv.toLocaleString()}</b></div>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-1">
        <div><span class="text-slate-400">薪資入帳帳戶</span><input type="text" id="wiz-sal-acc" value="台新薪轉戶" class="w-full p-1.5 mt-0.5 border"></div>
        <div class="flex items-end"><label class="flex items-center gap-1.5 pb-1.5"><input type="checkbox" id="wiz-gen-tx" checked> <span>自動產生本月固定記帳流水</span></label></div>
      </div>
    </div>

    <div class="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 space-y-1.5">
      <div class="font-bold text-cyan-400">步驟 2：核對本月資產總覽並同步 Google Sheet</div>
      <p class="text-slate-300">確認後將把本月最新帳戶餘額、薪資分配與所有個人/共同記帳明細一併寫入你的 Google Sheet 報表。</p>
    </div>

    <button id="btn-run-wizard" class="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold shadow">確認無誤，一鍵完成 ${monthStr} 月結與同步</button>
  `;

  document.getElementById("wizard-modal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();

  document.getElementById("btn-run-wizard").onclick = async () => {
    const uid = auth.currentUser.uid;
    const salAcc = document.getElementById("wiz-sal-acc").value.trim() || "台新薪轉戶";
    const genTx = document.getElementById("wiz-gen-tx").checked;
    const todayStr = new Date().toLocaleDateString("zh-TW");

    if (genTx) {
      if (totalSal > 0) {
        await addDoc(collection(db, "users", uid, "transactions"), {
          type: "收入", account: salAcc, currency: "TWD", amount: totalSal,
          mainCat: "其他", subCat: "薪水", name: `${monthStr} 實發薪資`,
          date: todayStr, time: "09:00", updatedAt: new Date().toISOString()
        });
      }
      if (mort > 0) {
        await addDoc(collection(db, "users", uid, "transactions"), {
          type: "轉出", account: salAcc, toAccount: "彰化銀行(房貸)", currency: "TWD", amount: mort,
          mainCat: "家居", subCat: "房租/房貸", name: `${monthStr} 房貸轉帳`,
          date: todayStr, time: "09:05", updatedAt: new Date().toISOString()
        });
      }
      if (luna > 0) {
        await addDoc(collection(db, "users", uid, "transactions"), {
          type: "轉出", account: salAcc, toAccount: "國泰嚕哪基金", currency: "TWD", amount: luna,
          mainCat: "貓咪", subCat: "嚕哪飼料/罐頭", name: `${monthStr} 嚕哪每月基金`,
          date: todayStr, time: "09:10", updatedAt: new Date().toISOString()
        });
      }
    }

    await window.__FINANCE_APP__.reloadAll();
    document.getElementById("wizard-modal").classList.add("hidden");
    // 觸發同步至 Google Sheet
    document.getElementById("btn-sync-sheet")?.click();
    window.showToast(`${monthStr} 月結確認完成並已同步！`);
  };
}

function escHtml(t) {
  return String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}