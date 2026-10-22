// content.js
console.log("content script loaded");

// 移除廣告（元素可能不存在，用 optional chaining 避免整個腳本崩潰）
document.querySelector('[id="yspcontentheader"]')?.remove();
document.querySelector('[id="ad_mid_right"]')?.remove();

// 產生雷達圖時要載入的本地 chart.js（避免依賴外部 CDN）
const CHARTJS_URL = chrome.runtime.getURL("chart.umd.min.js");

// 若已存在就先移除，避免重複插入
const EXISTING_ID = "mv3-overlay-root";
const old = document.getElementById(EXISTING_ID);
if (old) old.remove();

// 建立固定定位的宿主，使用極高 z-index 並避開頁面排版
const host = document.createElement("div");
host.id = EXISTING_ID;
host.style.position = "fixed";
host.style.top = "12px";
host.style.right = "12px";
host.style.zIndex = "2147483647"; // 最高 z-index 之一
host.style.isolation = "isolate";  // 幫助分離疊圖
host.style.pointerEvents = "auto"; // 允許互動
document.documentElement.appendChild(host);

// 使用 Shadow DOM 隔離樣式，避免污染或被網站 CSS 影響
const shadow = host.attachShadow({ mode: "open" });

// 面板樣式（極簡亮白 A 風格）
const style = document.createElement("style");
style.textContent = `
  :host, * { box-sizing: border-box; }

  .panel {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 280px;
    max-width: 340px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    box-shadow: 0 12px 28px rgba(0,0,0,.14), 0 2px 8px rgba(0,0,0,.08);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans TC", Roboto, Arial;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    background: #f8fafc;
    border-bottom: 1px solid #eef;
    cursor: move;
    user-select: none;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6366f1; flex: 0 0 auto; }
  .title { font-size: 13px; color: #111827; font-weight: 700; }
  .spacer { flex: 1 1 auto; }
  .close {
    appearance: none; border: 0; background: transparent;
    font-size: 16px; line-height: 1; padding: 4px 6px;
    cursor: pointer; color: #9ca3af; border-radius: 6px;
  }
  .close:hover { color: #111827; background: #eef2ff; }

  .body { padding: 14px; background: #ffffff; }

  form { display: grid; grid-template-columns: 1fr auto; gap: 8px; }

  input[type="text"] {
    min-width: 0; width: 100%; height: 38px;
    padding: 8px 14px; border: 1px solid #d1d5db; border-radius: 999px;
    outline: none; font-size: 14px; background: #ffffff; color: #111827;
  }
  input[type="text"]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.18); }

  .btn {
    height: 38px; padding: 0 18px; border: none; border-radius: 999px;
    font-size: 14px; font-weight: 700; cursor: pointer;
    background: #6366f1; color: #ffffff;
    transition: transform .02s ease, opacity .12s ease, box-shadow .12s ease;
    box-shadow: 0 2px 6px rgba(99,102,241,.35);
  }
  .btn:hover { opacity: .95; }
  .btn:active { transform: translateY(1px); }

  .dragging { opacity: .95; cursor: grabbing; }
  @media (max-width: 420px) { .panel { min-width: 240px; } }

  .progress { margin-top: 12px; display: none; gap: 8px; }
  .progress-label { font-size: 12px; color: #6b7280; min-width: 160px; }
  .progress-track {
    position: relative; width: 100%; height: 8px;
    background: #eef; border-radius: 999px; overflow: hidden;
  }
  .progress-fill {
    position: absolute; inset: 0 auto 0 0; width: 0%;
    background: #6366f1; border-radius: 999px; transition: width .25s ease;
  }
`;

// 建立結構
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

    <div class="progress" aria-live="polite" aria-atomic="true">
      <div class="progress-label">準備中…</div>
      <div class="progress-track">
        <div class="progress-fill"></div>
      </div>
    </div>
  </div>
`;

// 掛入 Shadow DOM
shadow.appendChild(style);
shadow.appendChild(wrapper);

// 事件：阻擋冒泡，避免影響頁面
wrapper.addEventListener("click", (e) => e.stopPropagation());
wrapper.addEventListener("mousedown", (e) => e.stopPropagation());
wrapper.addEventListener("mouseup", (e) => e.stopPropagation());
wrapper.addEventListener("keydown", (e) => e.stopPropagation());

// 取得進度 DOM
const progressWrap = shadow.querySelector(".progress");
const progressFill = shadow.querySelector(".progress-fill");
const progressLabel = shadow.querySelector(".progress-label");
const submitBtn = shadow.querySelector(".btn");

// 進度工具：顯示/更新/收起
function showProgress(show) {
  progressWrap.style.display = show ? "grid" : "none";
}
function setProgress(current, total, done = false) {
  const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  progressFill.style.width = done ? "100%" : pct + "%";
  progressLabel.textContent = done
    ? "完成 ✅"
    : `爬取進度：第 ${current}/${total} 筆（${pct}%）`;
}
function disableForm(disabled) {
  input.disabled = disabled;
  submitBtn.disabled = disabled;
  submitBtn.style.opacity = disabled ? ".6" : "1";
  wrapper.setAttribute("aria-busy", disabled ? "true" : "false");
}

// methods

// 從聯盟當週計分板頁面，解析出所有真實對戰組合（mid1/mid2）。
// 只靠網址樣式（matchup?...mid1=A&mid2=B）比對，不依賴易變的 CSS class，
// 因此隊數多少都能自動對應，也較不受 Yahoo 改版影響。
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
    if (seen.has(key)) return; // 同一組對戰可能出現多個連結，去重
    seen.add(key);
    groups.push([mid1, mid2]);
  });
  return groups;
}

async function crawlItems(week, onTick) {
  // 從目前頁面網址取得聯盟 id，例如 /nba/51107/12 → "51107"
  const leagueId = window.location.pathname.match(/\/nba\/(\d+)/)?.[1];
  if (!leagueId) {
    throw new Error("無法從網址取得聯盟 id，請確認你在 Yahoo fantasy 聯盟頁面");
  }

  // 從該週計分板解析出真實對戰組合，不再寫死 12 隊
  const groups = await getMatchupGroups(leagueId, week);
  if (groups.length === 0) {
    throw new Error("找不到任何對戰組合，請確認週次正確且已登入 Yahoo（若持續發生，可能是 Yahoo 頁面結構改版）");
  }
  const total = groups.length;
  const items = [];

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    const current = idx + 1;

    onTick?.(current - 1, total); // 先更新到前一步，避免一開始就顯示 100%

    const [mid1, mid2] = group;
    const targetUrl = `https://basketball.fantasysports.yahoo.com/nba/${leagueId}/matchup?date=totals&week=${week}&mid1=${mid1}&mid2=${mid2}`;

    const doc = await fetch(targetUrl)
      .then((res) => res.text())
      .then((res) => new DOMParser().parseFromString(res, "text/html"));

    const tableDom = doc.querySelector('[id="matchup-wall-header"] > table');
    if (!tableDom) {
      console.warn("找不到表格：", targetUrl);
      continue;
    }

    const keys = Array.from(tableDom.querySelectorAll("thead th")).map(
      (d) => d.innerText
    );

    tableDom.querySelectorAll("tbody tr").forEach((dom) => {
      const item = {};
      dom.querySelectorAll("td").forEach((d, i) => {
        const val = d.innerText.replaceAll('*', '');
        if (keys[i]) item[keys[i]] = val;
      });
      items.push(item);
    });

    onTick?.(current, total); // 本組完成
  }

  onTick?.(total, total, true); // 全部完成
  return items;
}

// 表單送出：顯示進度、禁用表單、完成後開新分頁
const form = shadow.querySelector("form");
const input = shadow.querySelector('input[name="prompt"]');
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = (input.value || "").trim();
  if (!value) return;

  // 在使用者手勢仍有效時就先開好分頁，避免 await 之後被彈窗攔截。
  // 注意：帶 noopener 會拿不到 window 參考，所以這裡不加。
  const tableWin = window.open("", "_blank");
  const radarWin = window.open("", "_blank");

  try {
    disableForm(true);
    showProgress(true);
    progressLabel.textContent = "讀取對戰組合…"; // 總數要先抓計分板才知道，交給 onTick 設定

    const week = value;
    const itemsRaw = await crawlItems(week, (cur, total, done) => {
      setProgress(cur, total, !!done);
    });

    // 從網址取聯盟 id 當基準 key（crawl 已驗證過其存在）
    const leagueId = window.location.pathname.match(/\/nba\/(\d+)/)?.[1];
    const key = `baseline:${leagueId}`;

    // 載入該聯盟基準；以「排除當週」的先前池當量尺；先前池為空則 bootstrap 用當週
    const stored = (await chrome.storage.local.get(key))[key];
    const baseline = stored || { weeks: {} };
    const prior = { weeks: Object.assign({}, baseline.weeks) };
    delete prior.weeks[String(week)];
    const priorWeeks = NbaStats.baselineWeekCount(prior);
    const stats = priorWeeks === 0
      ? NbaStats.poolStats(NbaStats.updateBaseline(prior, itemsRaw, week))
      : NbaStats.poolStats(prior);

    // 計分（跨週可比戰力值）→ 小名次 → 產頁
    NbaStats.scoreWeek(itemsRaw, stats);
    NbaStats.rankColumns(itemsRaw);
    // 校準提示顯示「含本週」的累積週數（priorWeeks 不含當週，+1 才讀得通）
    openTableTab(itemsRaw, { title: `League Table - Week ${week}`, weeks: priorWeeks + 1 }, { table: tableWin, radar: radarWin });

    // 把本週併入基準並存回（以 week 為 key、取代）
    await chrome.storage.local.set({ [key]: NbaStats.updateBaseline(baseline, itemsRaw, week) });
  } catch (err) {
    console.error(err);
    progressLabel.textContent = "發生錯誤，請稍後重試。";
    // 出錯就關掉先前開好的空白分頁
    tableWin?.close();
    radarWin?.close();
  } finally {
    disableForm(false);
    input.value = "";
    setTimeout(() => showProgress(false), 800);
  }
});

// 關閉按鈕
shadow.querySelector(".close")?.addEventListener("click", () => {
  host.remove();
});

// ---- 簡易拖曳（拖 header）----
(() => {
  const header = shadow.querySelector(".header");
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let startRight = 0;

  const onMouseDown = (e) => {
    dragging = true;
    wrapper.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;

    const rect = host.getBoundingClientRect();
    startTop = rect.top;
    startRight = window.innerWidth - rect.right;

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newTop = Math.max(8, startTop + dy);
    const newRight = Math.max(8, startRight - dx);
    host.style.top = `${newTop}px`;
    host.style.right = `${newRight}px`;
  };

  const onMouseUp = () => {
    dragging = false;
    wrapper.classList.remove("dragging");
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
  };

  header.addEventListener("mousedown", onMouseDown);
})();

/* 開新分頁：表格頁 + 雷達圖頁（HTML 由 lib/render.js 產生，以 Blob URL 載入） */
function openTableTab(rows, opts = {}, targetWins = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("沒有資料可顯示。");
    targetWins.table?.close();
    targetWins.radar?.close();
    return;
  }
  const title = opts.title || "League Table";
  const weeks = opts.weeks;
  showInTab(targetWins.table, NbaRender.buildTablePage(rows, { title, weeks }));
  // rows 已含 Team 與 <metric>_score，buildRadarPage 直接取用；index 0 = Rank 1
  showInTab(targetWins.radar, NbaRender.buildRadarPage(rows, CHARTJS_URL, { weeks }));
}

// 把 HTML 以 Blob 載入指定分頁；沒有預開分頁時退回 window.open。
// 載入後延遲釋放 Blob URL，避免記憶體洩漏。
function showInTab(win, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  if (win && !win.closed) {
    win.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
