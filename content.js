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

// 建立樣式（含輕量 reset）
const style = document.createElement("style");
style.textContent = `
  :host, * { box-sizing: border-box; }

  /* 外框容器 */
  .panel {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 280px;
    max-width: 360px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    box-shadow: 0 10px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.12);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, "Apple Color Emoji","Segoe UI Emoji";
    overflow: hidden;
    /* 防止面板蓋住頁面而無法點擊到它自身以外的元素時，可用 backdrop 控制 */
  }

  /* 頂部列：徽章 + 拖曳區 */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: #f8fafc;
    border-bottom: 1px solid #e5e7eb;
    cursor: move;                  /* 可拖曳提示 */
    user-select: none;
  }

  .badge {
    flex: 0 0 auto;
    background: #f8fafc;           /* 指定的 Extension 背景色 */
    color: #111827;
    font-weight: 600;
    font-size: 12px;
    line-height: 1;
    padding: 6px 8px;
    border-radius: 6px;
  }

  .title {
    font-size: 13px;
    color: #374151;
    font-weight: 600;
  }

  .spacer { flex: 1 1 auto; }

  .close {
    appearance: none;
    border: 0;
    background: transparent;
    font-size: 16px;
    line-height: 1;
    padding: 4px 6px;
    cursor: pointer;
    color: #6b7280;
  }
  .close:hover { color: #111827; }

  /* 內容區：表單 */
  .body {
    padding: 12px;
    background: #ffffff;
  }

  form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  input[type="text"] {
    min-width: 0;
    width: 100%;
    height: 36px;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    outline: none;
    font-size: 14px;
    background: #ffffff;
  }
  input[type="text"]:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
  }

  .btn {
    height: 36px;
    padding: 0 14px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    background: #10b981;    /* 綠色系，接近你原本 #4CAF50 的感覺 */
    color: #ffffff;
    transition: transform .02s ease, box-shadow .12s ease, opacity .12s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  }
  .btn:hover { opacity: .95; }
  .btn:active { transform: translateY(1px); }

  /* 可拖曳時的視覺 */
  .dragging { opacity: 0.9; cursor: grabbing; }

  /* 小螢幕時稍微縮小寬度 */
  @media (max-width: 420px) {
    .panel { min-width: 240px; }
  }

    /* 進度條區塊 */
  .progress {
    margin-top: 10px;
    display: none;                /* 預設隱藏，開始爬再顯示 */
    gap: 8px;
  }
  .progress-label {
    font-size: 12px;
    color: #374151;
    min-width: 160px;
  }
  .progress-track {
    position: relative;
    width: 100%;
    height: 8px;
    background: #e5e7eb;
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0%;
    background: #60a5fa;
    border-radius: 999px;
    transition: width .25s ease;
  }

`;

// 建立結構
const wrapper = document.createElement("div");
wrapper.className = "panel";
wrapper.innerHTML = `
  <div class="header" part="header" aria-label="Extension header" role="toolbar">
    <div class="badge" aria-hidden="true">Extension 小工具</div>
    <div class="title"></div>
    <div class="spacer"></div>
    <button class="close" title="關閉" aria-label="關閉面板">✕</button>
  </div>
  <div class="body">
    <form novalidate>
      <input type="text" name="prompt" placeholder="輸入week…" aria-label="輸入week" />
      <button class="btn" type="submit" aria-label="送出">送出</button>
    </form>

    <!-- 進度條區塊 -->
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

    console.log(`爬取第 ${current} 筆資料，總共${total}筆`);
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
      dom.querySelectorAll("td").forEach((d, idx) => {
        const val = d.innerText.replaceAll('*', '');
        if (keys[idx]) item[keys[idx]] = val;
      });
      items.push(item);
    });

    onTick?.(current, total); // 本組完成
  }

  onTick?.(total, total, true); // 全部完成
  console.log(JSON.stringify(items))
  return items;
}

function caculateItems(items) {
    const metrics = ["FG%", "FT%", "3PTM", "3PT%", "PTS", "REB", "AST", "ST", "BLK", "TO", "DD"];
    const reverse = ["TO"];

    if (!Array.isArray(items) || items.length === 0) return items;

    // 把抓下來的字串安全轉成數字；無法解析回傳 null（視為缺值）
    const toNum = (v) => {
      const n = Number(String(v ?? "").replace(/[^0-9.+-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    // === 工具函數 ===
    function normalize(values, reverse = false) {
      const valid = values.filter(v => v !== null && Number.isFinite(v));
      if (valid.length === 0) return values.map(_ => 50); // 整欄無有效值

      const min = Math.min(...valid);
      const max = Math.max(...valid);
      const range = max - min;
      // 缺值一律視為最差（映射到最低分 20）
      if (range === 0) return values.map(v => (v === null || !Number.isFinite(v)) ? 20 : 50);

      return values.map(v => {
        if (v === null || !Number.isFinite(v)) return 20;
        const s = reverse ? (max - v) / range : (v - min) / range;
        return 20 + s * 80;
      });
    }

    // === 計算每隊每項分數 ===
    for (const metric of metrics) {
      const values = items.map(t => toNum(t[metric]));
      const scores = normalize(values, reverse.includes(metric));
      items.forEach((t, i) => t[metric + "_score"] = Number(scores[i].toFixed(2)));
    }

    // === 總分與排名 ===
    items.forEach(t => {
      const scores = metrics.map(m => t[m + "_score"]);
      t.Total = Number((scores.reduce((a, b) => a + b, 0) / metrics.length).toFixed(2));;
    });

    items.sort((a, b) => b.Total - a.Total);
    items.forEach((t, i) => t.Rank = i + 1);
    console.table(
      items.map(t => {
        const obj = { Rank: t.Rank, Team: t.Team, Total: t.Total.toFixed(2) };
        metrics.forEach(m => obj[m] = t[m + "_score"].toFixed(1));
        return obj;
      })
    );
    return items
}

// 表單送出：目前先 console.log，你可改成傳訊息給 background
const form = shadow.querySelector("form");
const input = shadow.querySelector('input[name="prompt"]');
// 表單送出：顯示進度、禁用表單、完成後開新分頁
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

    console.log('itemsRaw', itemsRaw)
    const items = caculateItems(itemsRaw);
    openTableTab(items, { title: `League Table - Week ${week}` }, { table: tableWin, radar: radarWin });
  } catch (err) {
    console.error(err);
    progressLabel.textContent = "發生錯誤，請稍後重試。";
    // 出錯就關掉先前開好的空白分頁
    tableWin?.close();
    radarWin?.close();
  } finally {
    disableForm(false);
    input.value = "";
    // 你也可以選擇保留進度條幾秒再隱藏
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

    // 目前位置（固定定位 + 右上角）
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

    // 以 top/right 重新定位
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




/* 開新分頁的部分 */
// 將資料陣列 -> 產生新分頁的 HTML 表格
function openTableTab(rows, opts = {}, targetWins = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("沒有資料可顯示。");
    targetWins.table?.close();
    targetWins.radar?.close();
    return;
  }
  const title = opts.title || "Table";
  const cols = collectColumns(rows);

  // 🔹 新增：每欄位加上名次
  addRanksToRows(rows, cols);

  // 把 Blob 內容載入先前開好的分頁（保留使用者手勢，避免被彈窗攔截）
  const html = buildHtmlPage(title, cols, rows);
  showInTab(targetWins.table, html);

  // 雷達圖
  const data = rows.map(t => ({
    "Team": t["Team"],
    "FG%": t["FG%_score"],
    "FT%": t["FT%_score"],
    "3PTM": t["3PTM_score"],
    "3PT%": t["3PT%_score"],
    "PTS": t["PTS_score"],
    "REB": t["REB_score"],
    "AST": t["AST_score"],
    "ST": t["ST_score"],
    "BLK": t["BLK_score"],
    "TO": t["TO_score"],
    "DD": t["DD_score"]
  }))
  const radarHtml = buildRadarChart(data)
  showInTab(targetWins.radar, radarHtml);
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
  // 分頁一旦導覽就會抓取內容，稍後釋放即可（保留幾秒供載入）。
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// 🔹 計算每個欄位名次
function addRanksToRows(rows, cols) {
  const exclude = new Set(["Team","Rank","Total"]);
  for (const col of cols) {
    if (exclude.has(col)) continue;
    const values = rows.map(r => Number(r[col])).map(v => isNaN(v)?null:v);
    if (values.every(v=>v===null)) continue;
    const sorted = [...values]
      .map((v,i)=>({v,i}))
      .filter(d=>d.v!==null)
      .sort((a,b)=>b.v-a.v);
    let rank = 1;
    for (let i=0;i<sorted.length;i++){
      if (i>0 && sorted[i].v!==sorted[i-1].v) rank=i+1;
      rows[sorted[i].i][`${col}_rank`]=rank;
    }
  }
}

function collectColumns(rows) {
  // 以第一列的 key 順序為主，並補齊其餘列中出現但第一列沒有的欄位
  const first = Object.keys(rows[0] || {});
  const set = new Set(first);
  for (const r of rows) for (const k of Object.keys(r)) if (!set.has(k)) set.add(k);
  return Array.from(set);
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHtmlPage(title, cols, rows) {
  // 簡單排序功能（點表頭切換 ASC/DESC）
  const script = `
  (() => {
    const table = document.querySelector("table");
    const getVal = (td) => {
      const raw = td.getAttribute("data-raw") ?? td.textContent;
      const num = Number(raw);
      return Number.isFinite(num) ? num : raw;
    };
    let sortState = { index: -1, dir: 1 };
    document.querySelectorAll("th").forEach((th, i) => {
      th.addEventListener("click", () => {
        const tbody = table.tBodies[0];
        const rows = Array.from(tbody.rows);
        const dir = (sortState.index === i) ? -sortState.dir : 1;
        sortState = { index: i, dir };
        rows.sort((a,b) => {
          const av = getVal(a.cells[i]);
          const bv = getVal(b.cells[i]);
          if (av < bv) return -1*dir;
          if (av > bv) return 1*dir;
          return 0;
        });
        tbody.append(...rows);
        document.querySelectorAll("th").forEach(x => x.removeAttribute("data-sort"));
        th.setAttribute("data-sort", dir === 1 ? "asc" : "desc");
      });
    });
  })();
  `;

  const styles = `
    :root { color-scheme: light dark; }
    body {
      margin: 24px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial;
      background: #f6f7f9;
      color: #111827;
    }
    .wrap {
      max-width: 1600px;
      margin: 0 auto;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 12px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      background: #c0c0c0;     /* 你指定的 Extension 小區塊色 */
      color: #111;
      border-radius: 6px;
      padding: 4px 8px;
      font-weight: 700;
      font-size: 12px;
    }
    .table-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow: 0 10px 24px rgba(0,0,0,.06);
      overflow: hidden;
    }
    .table-scroll {
      overflow: auto;
      max-height: 80vh;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      min-width: 900px;
    }
    thead th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      padding: 10px 12px;
      font-size: 12px;
      letter-spacing: .02em;
      cursor: pointer;
      user-select: none;
    }
    thead th[data-sort="asc"]::after { content: " ▲"; }
    thead th[data-sort="desc"]::after { content: " ▼"; }

    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
      vertical-align: top;
      white-space: nowrap;
    }
    tbody tr:hover td { background: #f2f8ff; }

    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .team { 
      font-weight: 600;
      position: sticky;
      left: 0;
      background: inherit;
      z-index: 1;
      border-right: 1px solid #e5e7eb;
    }
  `;
  
  // 生成表頭
  const thead = `
    <thead>
      <tr>${cols.map(c => {
        let bgColor = '#fff';
        // ["Total","Rank","FG%_rank","FT%_rank","3PTM_rank","3PTA*_rank","3PT%_rank","PTS_rank","REB_rank","AST_rank","ST_rank","BLK_rank","TO_rank","DD_rank","FG%_score_rank","FT%_score_rank","3PTM_score_rank","3PT%_score_rank","PTS_score_rank","REB_score_rank","AST_score_rank","ST_score_rank","BLK_score_rank","TO_score_rank","DD_score_rank"]

        if (["FGM/A*","FG%","FTM/A*","FT%","3PTM","3PTA*","3PT%","PTS","REB","AST","ST","BLK","TO","DD"].includes(c)) {
          bgColor = "#c0c0c0"
        } else if (["FG%_score","FT%_score","3PTM_score","3PT%_score","PTS_score","REB_score","AST_score","ST_score","BLK_score","TO_score","DD_score"].includes(c)) {
          bgColor = "#B0B0B0"
        }
        return `<th style="background: ${bgColor}" title="${escapeHtml(c)}">${escapeHtml(c)}</th>`
      }).join("")}</tr>
    </thead>`;

  // 生成內容列（數值靠右）
  // 依實際隊數動態產生等分色帶，不再寫死 12 格
  const colors = rows.map((_, i) =>
    `hsl(${Math.round((i * 360) / rows.length)}, 45%, 90%)`
  );

  const rowsHtml = rows.map((r, idx) => {
    const color = colors[idx] ?? "#ffffff";
    return `<tr style="background: ${color}">${
      cols.map(c => {
        const v = r[c] ?? "";
        const rank = r[`${c}_rank`];
        const showRank = rank ? ` (${rank})` : "";
        const display = `${v}${showRank}`;
        const raw = typeof v==="number"?v:String(v).trim();
        const isNum = typeof v==="number" || /^[+-]?\\d+(\\.\\d+)?$/.test(String(v));
        const cls = (c==="Team")?"team":(isNum?"num":"");
        return `<td class="${cls}" data-raw="${escapeHtml(raw)}">${escapeHtml(display)}</td>`;
      }).join("")
    }</tr>`;
  }).join("");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head>
<body>
  <div class="wrap">
    <h1><span class="badge">Extension</span> ${escapeHtml(title)}</h1>
    <div class="table-card">
      <div class="table-scroll">
        <table>
          ${thead}
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  </div>
  <script>${script}<\/script>
</body>
</html>`;
}


// 讓 JSON 可安全嵌入 inline <script>：跳脫 < > &，
// 避免隊名含 </script> 之類字串造成 HTML/JS injection。
function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildRadarChart(data) {

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>11-Sided Radar Chart</title>
    <script src="${CHARTJS_URL}"></script>
</head>
<body>
    <canvas id="radarChart" width="600" height="600"></canvas>

    <script>
        const data = ${safeJsonForScript(data)};


        // 雷達 11 個欄位
        const labels = ["FG%", "FT%", "3PTM", "3PT%", "PTS", "REB", "AST", "ST", "BLK", "TO", "DD"];

        // 非數值（缺值、意外型別）一律以 0 呈現，避免破圖
        const cleanValue = v => (Number.isFinite(v) ? v : 0);

        // 把每個 team 的資料轉成 array dataset
        const datasets = data.map((team, i) => ({
            label: team["Team"],
            data: labels.map(k => cleanValue(team[k])),
            fill: true,
            borderWidth: 2
        }));

        new Chart(document.getElementById("radarChart"), {
            type: "radar",
            data: { labels, datasets },
            options: {
                responsive: false,
                scales: {
                    r: {
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                }
            }
        });
    </script>
</body>
</html>
  `
}
