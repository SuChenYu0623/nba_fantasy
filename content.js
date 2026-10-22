// content.js
// 頁內儀表板：角落啟動器 + 全幅 overlay（皆 Shadow DOM 隔離）。
// 送出/重新整理才爬蟲；開啟儀表板/切分頁一律讀快取。Chart.js 由 content script
// 先載入（manifest），直接畫到 Shadow DOM 內的 canvas，不再開 Blob 分頁。
console.log("content script loaded");

// 移除廣告（元素可能不存在，用 optional chaining 避免整個腳本崩潰）
document.querySelector('[id="yspcontentheader"]')?.remove();
document.querySelector('[id="ad_mid_right"]')?.remove();

const METRICS = (window.NbaStats && NbaStats.METRICS) || ["FG%", "FT%", "3PTM", "3PT%", "PTS", "REB", "AST", "ST", "BLK", "TO", "DD"];

// ============================================================
// 工具
// ============================================================
function leagueIdFromUrl() {
  return window.location.pathname.match(/\/nba\/(\d+)/)?.[1];
}
async function storageGet(key) {
  return (await chrome.storage.local.get(key))[key];
}

// ============================================================
// 角落啟動器（Shadow DOM 常駐）
// ============================================================
const LAUNCHER_ID = "mv3-overlay-root";
document.getElementById(LAUNCHER_ID)?.remove();

const host = document.createElement("div");
host.id = LAUNCHER_ID;
host.style.position = "fixed";
host.style.top = "12px";
host.style.right = "12px";
host.style.zIndex = "2147483647";
host.style.isolation = "isolate";
host.style.pointerEvents = "auto";
document.documentElement.appendChild(host);

const shadow = host.attachShadow({ mode: "open" });

const style = document.createElement("style");
style.textContent = `
  :host, * { box-sizing: border-box; }
  .panel {
    display: grid; grid-template-rows: auto 1fr;
    min-width: 280px; max-width: 340px;
    background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px;
    box-shadow: 0 12px 28px rgba(0,0,0,.14), 0 2px 8px rgba(0,0,0,.08);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans TC", Roboto, Arial;
    overflow: hidden;
  }
  .header {
    display: flex; align-items: center; gap: 8px; padding: 11px 14px;
    background: #f8fafc; border-bottom: 1px solid #eef; cursor: move; user-select: none;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6366f1; flex: 0 0 auto; }
  .title { font-size: 13px; color: #111827; font-weight: 700; }
  .spacer { flex: 1 1 auto; }
  .close {
    appearance: none; border: 0; background: transparent; font-size: 16px; line-height: 1;
    padding: 4px 6px; cursor: pointer; color: #9ca3af; border-radius: 6px;
  }
  .close:hover { color: #111827; background: #eef2ff; }
  .body { padding: 14px; background: #ffffff; display: grid; gap: 10px; }
  form { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  input[type="text"] {
    min-width: 0; width: 100%; height: 38px; padding: 8px 14px;
    border: 1px solid #d1d5db; border-radius: 999px; outline: none; font-size: 14px;
    background: #ffffff; color: #111827;
  }
  input[type="text"]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.18); }
  .btn {
    height: 38px; padding: 0 18px; border: none; border-radius: 999px; font-size: 14px;
    font-weight: 700; cursor: pointer; background: #6366f1; color: #ffffff;
    transition: transform .02s ease, opacity .12s ease, box-shadow .12s ease;
    box-shadow: 0 2px 6px rgba(99,102,241,.35);
  }
  .btn:hover { opacity: .95; }
  .btn:active { transform: translateY(1px); }
  .btn.ghost { background: #eef2ff; color: #4f46e5; box-shadow: none; }
  .row2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .row2 .btn { height: 34px; padding: 0 14px; font-size: 13px; }
  .perf { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; cursor: pointer; user-select: none; }
  .perf input { width: 34px; height: 20px; appearance: none; background: #d1d5db; border-radius: 999px; position: relative; cursor: pointer; transition: background .15s ease; flex: 0 0 auto; }
  .perf input:checked { background: #6366f1; }
  .perf input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
  .perf input:checked::after { transform: translateX(14px); }
  .dragging { opacity: .95; cursor: grabbing; }
  @media (max-width: 420px) { .panel { min-width: 240px; } }
  .progress { display: none; gap: 8px; }
  .progress-label { font-size: 12px; color: #6b7280; min-width: 160px; }
  .progress-track { position: relative; width: 100%; height: 8px; background: #eef; border-radius: 999px; overflow: hidden; }
  .progress-fill { position: absolute; inset: 0 auto 0 0; width: 0%; background: #6366f1; border-radius: 999px; transition: width .25s ease; }
`;

const wrapper = document.createElement("div");
wrapper.className = "panel";
wrapper.innerHTML = `
  <div class="header" part="header" aria-label="Extension header" role="toolbar">
    <span class="dot" aria-hidden="true"></span>
    <div class="title">NBA Fantasy 輔助</div>
    <div class="spacer"></div>
    <button class="close" title="關閉" aria-label="關閉面板">✕</button>
  </div>
  <div class="body">
    <form novalidate>
      <input type="text" name="prompt" placeholder="輸入 week…" aria-label="輸入 week" />
      <button class="btn" type="submit" aria-label="送出">送出</button>
    </form>
    <div class="row2">
      <button class="btn ghost open-dash" type="button" aria-label="開啟儀表板">開啟儀表板</button>
      <label class="perf" title="只封鎖圖片載入，省流量（變更後需重新整理頁面才對已載入圖生效）">
        <input type="checkbox" class="perf-toggle" aria-label="效能模式" />
        <span>⚡ 效能模式</span>
      </label>
    </div>
    <div class="progress" aria-live="polite" aria-atomic="true">
      <div class="progress-label">準備中…</div>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>
  </div>
`;

shadow.appendChild(style);
shadow.appendChild(wrapper);

// 阻擋冒泡，避免影響頁面
["click", "mousedown", "mouseup", "keydown"].forEach((ev) =>
  wrapper.addEventListener(ev, (e) => e.stopPropagation())
);

const progressWrap = shadow.querySelector(".progress");
const progressFill = shadow.querySelector(".progress-fill");
const progressLabel = shadow.querySelector(".progress-label");
const submitBtn = shadow.querySelector(".btn");
const form = shadow.querySelector("form");
const input = shadow.querySelector('input[name="prompt"]');
const openDashBtn = shadow.querySelector(".open-dash");
const perfToggle = shadow.querySelector(".perf-toggle");

function showProgress(show) { progressWrap.style.display = show ? "grid" : "none"; }
function setProgress(current, total, done = false) {
  const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  progressFill.style.width = done ? "100%" : pct + "%";
  progressLabel.textContent = done ? "完成 ✅" : `爬取進度：第 ${current}/${total} 筆（${pct}%）`;
}
function disableForm(disabled) {
  input.disabled = disabled;
  submitBtn.disabled = disabled;
  submitBtn.style.opacity = disabled ? ".6" : "1";
  openDashBtn.disabled = disabled;
  wrapper.setAttribute("aria-busy", disabled ? "true" : "false");
}

// 效能模式：讀目前旗標設初值（undefined → ON）；變更只寫 storage，
// 讓 background 的 storage.onChanged 觸發 updateEnabledRulesets。
(async () => {
  const perfMode = await storageGet("perfMode");
  perfToggle.checked = perfMode !== false;
})();
perfToggle.addEventListener("change", () => {
  chrome.storage.local.set({ perfMode: perfToggle.checked });
});

// 關閉啟動器
shadow.querySelector(".close")?.addEventListener("click", () => { host.remove(); });

// ---- 拖曳（拖 header）----
(() => {
  const header = shadow.querySelector(".header");
  let dragging = false, startX = 0, startY = 0, startTop = 0, startRight = 0;
  const onMove = (e) => {
    if (!dragging) return;
    host.style.top = `${Math.max(8, startTop + (e.clientY - startY))}px`;
    host.style.right = `${Math.max(8, startRight - (e.clientX - startX))}px`;
  };
  const onUp = () => {
    dragging = false;
    wrapper.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  };
  header.addEventListener("mousedown", (e) => {
    dragging = true;
    wrapper.classList.add("dragging");
    startX = e.clientX; startY = e.clientY;
    const rect = host.getBoundingClientRect();
    startTop = rect.top; startRight = window.innerWidth - rect.right;
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
})();

// ============================================================
// 爬蟲（沿用既有邏輯，只重用輸出）
// ============================================================
async function getMatchupGroups(leagueId, week) {
  const url = `https://basketball.fantasysports.yahoo.com/nba/${leagueId}?week=${week}`;
  const doc = await fetch(url)
    .then((res) => res.text())
    .then((res) => new DOMParser().parseFromString(res, "text/html"));

  const seen = new Set();
  const groups = [];
  doc.querySelectorAll('a[href*="matchup"]').forEach((a) => {
    const href = a.getAttribute("href") || "";
    const m1 = href.match(/[?&]mid1=(\d+)/);
    const m2 = href.match(/[?&]mid2=(\d+)/);
    if (!m1 || !m2) return;
    const mid1 = Number(m1[1]);
    const mid2 = Number(m2[1]);
    const key = [mid1, mid2].sort((x, y) => x - y).join("-");
    if (seen.has(key)) return;
    seen.add(key);
    groups.push([mid1, mid2]);
  });
  return groups;
}

async function crawlItems(week, onTick) {
  const leagueId = leagueIdFromUrl();
  if (!leagueId) {
    throw new Error("無法從網址取得聯盟 id，請確認你在 Yahoo fantasy 聯盟頁面");
  }
  const groups = await getMatchupGroups(leagueId, week);
  if (groups.length === 0) {
    throw new Error("找不到任何對戰組合，請確認週次正確且已登入 Yahoo（若持續發生，可能是 Yahoo 頁面結構改版）");
  }
  const total = groups.length;
  const items = [];

  for (let idx = 0; idx < groups.length; idx++) {
    const [mid1, mid2] = groups[idx];
    const current = idx + 1;
    onTick?.(current - 1, total);

    const targetUrl = `https://basketball.fantasysports.yahoo.com/nba/${leagueId}/matchup?date=totals&week=${week}&mid1=${mid1}&mid2=${mid2}`;
    const doc = await fetch(targetUrl)
      .then((res) => res.text())
      .then((res) => new DOMParser().parseFromString(res, "text/html"));

    const tableDom = doc.querySelector('[id="matchup-wall-header"] > table');
    if (!tableDom) {
      console.warn("找不到表格：", targetUrl);
      continue;
    }
    const keys = Array.from(tableDom.querySelectorAll("thead th")).map((d) => d.innerText);
    tableDom.querySelectorAll("tbody tr").forEach((dom) => {
      const item = {};
      dom.querySelectorAll("td").forEach((d, i) => {
        const val = d.innerText.replaceAll("*", "");
        if (keys[i]) item[keys[i]] = val;
      });
      items.push(item);
    });
    onTick?.(current, total);
  }
  onTick?.(total, total, true);
  return items;
}

// ============================================================
// Lifecycle：送出 / 重新整理 / 開啟儀表板
// ============================================================

// 送出或重新整理：爬 → 計分 → 寫結果快取（完整 rows + ts + lastWeek）→ 基準寫回 → 開 overlay
async function runCrawlAndShow(weekRaw) {
  const week = String(weekRaw).trim();
  if (!week) return;

  const tableWinGuard = null; // 已無 Blob 分頁
  try {
    disableForm(true);
    showProgress(true);
    progressLabel.textContent = "讀取對戰組合…";

    const itemsRaw = await crawlItems(week, (cur, total, done) => setProgress(cur, total, !!done));

    const leagueId = leagueIdFromUrl();
    const bKey = `baseline:${leagueId}`;

    // 以「排除當週」的先前池當量尺；先前池為空則 bootstrap 用當週
    const stored = await storageGet(bKey);
    const baseline = stored || { weeks: {} };
    const prior = { weeks: Object.assign({}, baseline.weeks) };
    delete prior.weeks[String(week)];
    const priorWeeks = NbaStats.baselineWeekCount(prior);
    const stats = priorWeeks === 0
      ? NbaStats.poolStats(NbaStats.updateBaseline(prior, itemsRaw, week))
      : NbaStats.poolStats(prior);

    NbaStats.scoreWeek(itemsRaw, stats);   // 就地計分 + 排序
    NbaStats.rankColumns(itemsRaw);        // 就地加 <metric>_rank

    // 寫結果快取：rows 保留完整 scraped item（含 FGM/A* 等）+ 當次分數
    const rKey = `result:${leagueId}`;
    const rc = (await storageGet(rKey)) || {};
    rc[String(week)] = { rows: itemsRaw, ts: Date.now() };
    rc.lastWeek = Number(week);
    await chrome.storage.local.set({ [rKey]: rc });

    // 基準寫回（以 week 為 key、取代）
    await chrome.storage.local.set({ [bKey]: NbaStats.updateBaseline(baseline, itemsRaw, week) });

    await openDashboard(Number(week));
  } catch (err) {
    console.error(err);
    progressLabel.textContent = "發生錯誤，請稍後重試。";
  } finally {
    void tableWinGuard;
    disableForm(false);
    input.value = "";
    setTimeout(() => showProgress(false), 800);
  }
}

// 開啟儀表板：讀快取、顯示指定週（預設 lastWeek）；無快取提示送出。不重抓。
async function openDashboard(weekArg) {
  const leagueId = leagueIdFromUrl();
  if (!leagueId) { alert("無法從網址取得聯盟 id，請在 Yahoo fantasy 聯盟頁面使用。"); return; }

  const rKey = `result:${leagueId}`;
  const rc = await storageGet(rKey);
  if (!rc || rc.lastWeek == null) { alert("尚無資料，請先送出。"); return; }

  const week = (weekArg != null) ? Number(weekArg) : Number(rc.lastWeek);
  const entry = rc[String(week)];
  if (!entry || !Array.isArray(entry.rows) || entry.rows.length === 0) { alert("該週尚無資料，請先送出。"); return; }

  const bKey = `baseline:${leagueId}`;
  const baseline = (await storageGet(bKey)) || { weeks: {} };

  renderOverlay({
    leagueId, week,
    rows: entry.rows,
    ts: entry.ts,
    cache: rc,
    baseline,
    weeksCount: NbaStats.baselineWeekCount(baseline),
  });
}

form.addEventListener("submit", (e) => { e.preventDefault(); runCrawlAndShow(input.value); });
openDashBtn.addEventListener("click", () => { openDashboard(); });

// ============================================================
// Overlay（全幅，Shadow DOM 隔離）
// ============================================================
let overlayHost = null;
let overlayShadow = null;
let OV = null; // 目前 overlay 狀態

function buildOverlayHost() {
  if (overlayHost) return;
  overlayHost = document.createElement("div");
  overlayHost.id = "mv3-dashboard-overlay";
  overlayHost.style.position = "fixed";
  overlayHost.style.inset = "0";
  overlayHost.style.zIndex = "2147483646";
  overlayHost.style.display = "none";
  document.documentElement.appendChild(overlayHost);
  overlayShadow = overlayHost.attachShadow({ mode: "open" });

  const st = document.createElement("style");
  st.textContent = overlayCss();
  overlayShadow.appendChild(st);

  const root = document.createElement("div");
  root.className = "ov";
  root.innerHTML = overlayMarkup();
  overlayShadow.appendChild(root);

  ["click", "mousedown", "mouseup", "keydown", "wheel"].forEach((ev) =>
    root.addEventListener(ev, (e) => e.stopPropagation())
  );

  overlayShadow.querySelector(".backdrop").addEventListener("click", hideOverlay);
  overlayShadow.querySelector(".ov-close").addEventListener("click", hideOverlay);
  overlayShadow.querySelector(".ov-refresh").addEventListener("click", () => {
    if (OV) runCrawlAndShow(OV.week);
  });
  overlayShadow.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.getAttribute("data-tab")))
  );
}

function overlayCss() {
  return `
  :host, * { box-sizing: border-box; }
  .backdrop { position: fixed; inset: 0; background: rgba(17,24,39,.45); }
  .ov { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans TC", Roboto, Arial; color: #111827; }
  .sheet {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(1200px, 95vw); height: min(840px, 92vh);
    background: #f6f7f9; border-radius: 16px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,.35); display: grid; grid-template-rows: auto auto 1fr;
    animation: pop .14s ease;
  }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, -48%) scale(.98); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
  .ov-header { display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 6px 12px; padding: 14px 18px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .ov-head-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .ov-title { font-size: 16px; font-weight: 800; display: inline-flex; align-items: center; gap: 8px; }
  .badge { background: #6366f1; color: #fff; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
  .ov-league { font-size: 13px; color: #6b7280; }
  .ov-meta { grid-column: 1 / 2; font-size: 12px; color: #6b7280; }
  .ov-refresh { appearance: none; border: 0; background: transparent; color: #6366f1; font-weight: 700;
    cursor: pointer; font-size: 12px; padding: 0 2px; }
  .ov-refresh:hover { text-decoration: underline; }
  .ov-close { grid-row: 1 / 3; grid-column: 2; align-self: start; appearance: none; border: 0; background: transparent;
    font-size: 20px; line-height: 1; cursor: pointer; color: #9ca3af; border-radius: 8px; padding: 4px 8px; }
  .ov-close:hover { color: #111827; background: #eef2ff; }
  .ov-tabs { display: flex; align-items: center; gap: 6px; padding: 10px 18px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .tab { appearance: none; border: 1px solid transparent; background: transparent; color: #6b7280;
    font-size: 13px; font-weight: 700; padding: 7px 14px; border-radius: 999px; cursor: pointer; }
  .tab:hover { background: #f3f4f6; }
  .tab.on { background: #eef2ff; color: #4f46e5; }
  .calib { margin-left: auto; font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a;
    padding: 4px 10px; border-radius: 999px; }
  .calib.ok { color: #6b7280; background: #f3f4f6; border-color: #e5e7eb; }
  .ov-body { position: relative; overflow: hidden; padding: 16px 18px 18px; }
  .pane { position: absolute; inset: 16px 18px 18px; overflow: auto; }
  .pane[hidden] { display: none; }

  /* ---- 表格 fragment 樣式（buildTableFragment 用到的 class）---- */
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.06); overflow: hidden; }
  .scroll { overflow: auto; max-height: calc(92vh - 220px); }
  table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 760px; }
  thead th { position: sticky; top: 0; z-index: 2; background: #f8fafc; color: #6b7280; text-align: right;
    font-size: 11px; letter-spacing: .03em; text-transform: uppercase; padding: 11px 12px;
    border-bottom: 1px solid #e5e7eb; cursor: pointer; user-select: none; white-space: nowrap; }
  thead th.team { text-align: left; }
  thead th[data-sort="asc"]::after { content: " ▲"; }
  thead th[data-sort="desc"]::after { content: " ▼"; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; white-space: nowrap; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tbody tr:hover td { background: #eef2ff; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .rnk { color: #9ca3af; font-size: 11px; }
  .team { font-weight: 600; position: sticky; left: 0; background: #fff; z-index: 1; border-right: 1px solid #eef; }
  tbody tr:nth-child(even) td.team { background: #fafbfc; }
  tbody tr:hover td.team { background: #eef2ff; }
  .rk { display: inline-flex; min-width: 22px; height: 22px; align-items: center; justify-content: center;
    padding: 0 6px; border-radius: 7px; background: #eef2ff; color: #4f46e5; font-weight: 800; font-size: 12px; }
  .total { text-align: right; }
  .total b { color: #111827; }
  .dv { position: relative; display: inline-block; vertical-align: middle; width: 90px; height: 6px;
    background: #f1f5f9; border-radius: 999px; margin-right: 8px; }
  .dv-bar { position: absolute; top: 0; height: 100%; border-radius: 999px; }
  .dv-mid { position: absolute; left: 50%; top: -2px; width: 1px; height: 10px; background: #cbd5e1; }
  .nba-empty { padding: 40px; color: #6b7280; }

  /* ---- Chart 控制列與畫布 ---- */
  .ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
  .ctl label { font-size: 12px; color: #6b7280; }
  select { height: 34px; border: 1px solid #d1d5db; border-radius: 9px; padding: 0 10px; font-size: 13px; background: #fff; color: #111827; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid #d1d5db; background: #fff; color: #6b7280; cursor: pointer; }
  .chip.on { background: #10b981; border-color: transparent; color: #fff; }
  .chart-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.06); padding: 18px; }
  .canvas-wrap { position: relative; height: calc(92vh - 320px); min-height: 360px; }
  `;
}

function overlayMarkup() {
  return `
  <div class="backdrop"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="戰力儀表板">
    <div class="ov-header">
      <div class="ov-head-main">
        <span class="ov-title"><span class="badge">EXTENSION</span> 戰力儀表板</span>
        <span class="ov-league"></span>
      </div>
      <button class="ov-close" title="關閉" aria-label="關閉">✕</button>
      <div class="ov-meta"></div>
    </div>
    <div class="ov-tabs">
      <button class="tab on" data-tab="table">表格</button>
      <button class="tab" data-tab="radar">雷達</button>
      <button class="tab" data-tab="trend">趨勢</button>
      <span class="calib"></span>
    </div>
    <div class="ov-body">
      <div class="pane pane-table"></div>
      <div class="pane pane-radar" hidden>
        <div class="chart-card">
          <div class="ctl">
            <label>主隊</label><select class="radar-main"></select>
            <label>加入比較（最多 2）</label><div class="chips radar-chips"></div>
          </div>
          <div class="canvas-wrap"><canvas class="radar-canvas"></canvas></div>
        </div>
      </div>
      <div class="pane pane-trend" hidden>
        <div class="chart-card">
          <div class="ctl">
            <label>聚焦隊伍</label><select class="trend-focus"></select>
          </div>
          <div class="canvas-wrap"><canvas class="trend-canvas"></canvas></div>
        </div>
      </div>
    </div>
  </div>
  `;
}

function hideOverlay() {
  if (overlayHost) overlayHost.style.display = "none";
}

function destroyCharts() {
  if (OV && OV.charts) {
    OV.charts.radar?.destroy?.();
    OV.charts.trend?.destroy?.();
  }
}

function renderOverlay(ctx) {
  buildOverlayHost();
  destroyCharts();

  OV = {
    ...ctx,
    radar: { mainIdx: 0, compare: [] },
    trend: { focusIdx: 0, series: null, weeks: null },
    charts: { radar: null, trend: null },
    sort: { i: -1, dir: 1 },
    sortedRows: ctx.rows.slice(), // 預設照 Rank 順序
  };

  const q = (s) => overlayShadow.querySelector(s);
  q(".ov-league").textContent = `League ${ctx.leagueId} · Week ${ctx.week}`;
  q(".ov-meta").innerHTML = `資料時間 ${NbaRender.timeAgo(ctx.ts, Date.now())} · <button class="ov-refresh">重新整理</button>`;
  q(".ov-meta .ov-refresh").addEventListener("click", () => { if (OV) runCrawlAndShow(OV.week); });

  const calib = q(".calib");
  const n = ctx.weeksCount;
  if (n < 3) { calib.className = "calib"; calib.textContent = `基準校準中：已累積 ${n} 週，數字仍在熱身`; }
  else { calib.className = "calib ok"; calib.textContent = `已累積 ${n} 週`; }

  renderTablePane();
  populateRadarControls();
  populateTrendControls();

  // 回到表格分頁
  overlayShadow.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tab") === "table"));
  q(".pane-table").hidden = false;
  q(".pane-radar").hidden = true;
  q(".pane-trend").hidden = true;
  OV.activeTab = "table";

  overlayHost.style.display = "block";
}

// ---- 分頁切換 + 圖表 lazy init ----
function showTab(name) {
  if (!OV) return;
  overlayShadow.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tab") === name));
  overlayShadow.querySelector(".pane-table").hidden = name !== "table";
  overlayShadow.querySelector(".pane-radar").hidden = name !== "radar";
  overlayShadow.querySelector(".pane-trend").hidden = name !== "trend";
  OV.activeTab = name;
  if (name === "radar" && !OV.charts.radar) initRadarChart();
  if (name === "trend" && !OV.charts.trend) initTrendChart();
}

// ---- 表格：注入 fragment + 點欄排序（content.js 操作 Shadow DOM）----
const SORT_COLS = ["Rank", "Team", ...METRICS, "Total"];
function sortedTableRows() {
  const { i, dir } = OV.sort;
  if (i < 0) return OV.rows.slice();
  const col = SORT_COLS[i];
  const rows = OV.rows.slice();
  const numeric = col !== "Team";
  const valueOf = (r) => {
    if (col === "Rank") return Number(r.Rank);
    if (col === "Total") return Number(r.Total);
    if (col === "Team") return String(r.Team ?? "");
    return NbaStats.toNum(r[col]); // metric 原始值
  };
  rows.sort((a, b) => {
    let av = valueOf(a), bv = valueOf(b);
    if (numeric) { av = Number.isFinite(av) ? av : -Infinity; bv = Number.isFinite(bv) ? bv : -Infinity; }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
  return rows;
}
function renderTablePane() {
  const pane = overlayShadow.querySelector(".pane-table");
  pane.innerHTML = NbaRender.buildTableFragment(sortedTableRows());
  const ths = pane.querySelectorAll("thead th");
  ths.forEach((th, i) => {
    if (OV.sort.i === i) th.setAttribute("data-sort", OV.sort.dir === 1 ? "asc" : "desc");
    th.addEventListener("click", () => {
      OV.sort = { i, dir: OV.sort.i === i ? -OV.sort.dir : 1 };
      renderTablePane();
    });
  });
}

// ---- 雷達：主隊 select + 比較 chips，操作 Shadow DOM，更新 datasets ----
function populateRadarControls() {
  const rows = OV.rows;
  const sel = overlayShadow.querySelector(".radar-main");
  sel.innerHTML = "";
  rows.forEach((t, idx) => {
    const o = document.createElement("option");
    o.value = String(idx);
    o.textContent = String(t.Team ?? `#${idx + 1}`);
    sel.appendChild(o);
  });
  sel.value = "0";
  OV.radar.mainIdx = 0;
  OV.radar.compare = [];
  sel.onchange = () => {
    OV.radar.mainIdx = Number(sel.value);
    OV.radar.compare = OV.radar.compare.filter((i) => i !== OV.radar.mainIdx);
    renderRadarChips();
    updateRadar();
  };
  renderRadarChips();
}
function renderRadarChips() {
  const box = overlayShadow.querySelector(".radar-chips");
  box.innerHTML = "";
  OV.rows.forEach((t, idx) => {
    if (idx === OV.radar.mainIdx) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (OV.radar.compare.includes(idx) ? " on" : "");
    b.textContent = String(t.Team ?? `#${idx + 1}`);
    b.onclick = () => {
      const p = OV.radar.compare.indexOf(idx);
      if (p >= 0) OV.radar.compare.splice(p, 1);
      else { if (OV.radar.compare.length >= 2) OV.radar.compare.shift(); OV.radar.compare.push(idx); }
      renderRadarChips();
      updateRadar();
    };
    box.appendChild(b);
  });
}
function radarAxisMax() {
  const all = OV.rows.flatMap((t) => METRICS.map((m) => { const v = Number(t[m + "_score"]); return Number.isFinite(v) ? Math.abs(v) : 0; }));
  return Math.max(1, ...all);
}
function initRadarChart() {
  const canvas = overlayShadow.querySelector(".radar-canvas");
  const M = radarAxisMax();
  OV.charts.radar = new Chart(canvas, {
    type: "radar",
    data: { labels: METRICS, datasets: NbaRender.radarDatasets(OV.rows, OV.radar.mainIdx, OV.radar.compare) },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { r: { suggestedMin: -M, suggestedMax: M, grid: { color: "#e5e7eb" }, angleLines: { color: "#eef" }, pointLabels: { color: "#374151" }, ticks: { display: false } } },
      plugins: { legend: { display: true, position: "top", labels: { color: "#374151", boxWidth: 12 } } },
    },
  });
}
function updateRadar() {
  if (!OV.charts.radar) return;
  OV.charts.radar.data.datasets = NbaRender.radarDatasets(OV.rows, OV.radar.mainIdx, OV.radar.compare);
  OV.charts.radar.update();
}

// ---- 趨勢：對當前基準統一重算逐週 Total（跨週可比），聚焦 select ----
function ensureTrendSeries() {
  if (!OV.trend.series) {
    const { weeks, series } = NbaStats.trendSeries(OV.cache, OV.baseline);
    OV.trend.weeks = weeks;
    OV.trend.series = series;
    if (OV.trend.focusIdx >= series.length) OV.trend.focusIdx = 0;
  }
}
function populateTrendControls() {
  ensureTrendSeries();
  const sel = overlayShadow.querySelector(".trend-focus");
  sel.innerHTML = "";
  OV.trend.series.forEach((s, idx) => {
    const o = document.createElement("option");
    o.value = String(idx);
    o.textContent = String(s.team ?? `#${idx + 1}`);
    sel.appendChild(o);
  });
  sel.value = String(OV.trend.focusIdx);
  sel.onchange = () => { OV.trend.focusIdx = Number(sel.value); updateTrend(); };
}
function initTrendChart() {
  ensureTrendSeries();
  const canvas = overlayShadow.querySelector(".trend-canvas");
  OV.charts.trend = new Chart(canvas, {
    type: "line",
    data: {
      labels: OV.trend.weeks.map((w) => `W${w}`),
      datasets: NbaRender.trendDatasets(OV.trend.series, OV.trend.focusIdx),
    },
    options: {
      responsive: true, maintainAspectRatio: false, spanGaps: true,
      scales: { x: { grid: { color: "#f1f5f9" }, ticks: { color: "#6b7280" } }, y: { grid: { color: "#eef" }, ticks: { color: "#6b7280" } } },
      plugins: { legend: { display: true, position: "top", labels: { color: "#374151", boxWidth: 12 } } },
    },
  });
}
function updateTrend() {
  if (!OV.charts.trend) return;
  OV.charts.trend.data.datasets = NbaRender.trendDatasets(OV.trend.series, OV.trend.focusIdx);
  OV.charts.trend.update();
}
