// lib/render.js
// 產生輸出頁（表格頁、雷達圖頁）的純字串函式。dual-env：瀏覽器掛在 window.NbaRender，
// Node 以 require 取得。所有頁面皆自含（inline CSS / JS），以 Blob URL 開新分頁。
(function (root) {
  "use strict";

  const Stats = (typeof module !== "undefined" && module.exports)
    ? require("./stats.js")
    : (root.NbaStats || {});
  const METRICS = Stats.METRICS || ["FG%", "FT%", "3PTM", "3PT%", "PTS", "REB", "AST", "ST", "BLK", "TO", "DD"];

  function escapeHtml(s = "") {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ===== 表格頁（極簡亮白 A 風格）=====
  // 欄位＝ Rank · Team · 11 個評分項目原始值(各附小名次) · Total
  function buildTablePage(rows, opts = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return "<!doctype html><meta charset=utf-8><body style=\"font-family:system-ui;padding:40px;color:#6b7280\">沒有資料可顯示。</body>";
    }
    const title = opts.title || "League Table";
    const maxTotal = Math.max(...rows.map((r) => Number(r.Total) || 0), 1);

    const thead = `<thead><tr>
      <th data-k="Rank">#</th>
      <th data-k="Team" class="team">Team</th>
      ${METRICS.map((m) => `<th>${escapeHtml(m)}</th>`).join("")}
      <th data-k="Total">Total</th>
    </tr></thead>`;

    const body = rows.map((r) => {
      const cells = [];
      cells.push(`<td class="rank" data-raw="${Number(r.Rank) || ""}"><span class="rk">${escapeHtml(r.Rank)}</span></td>`);
      cells.push(`<td class="team">${escapeHtml(r.Team)}</td>`);
      for (const m of METRICS) {
        const val = r[m] ?? "";
        const rank = r[m + "_rank"];
        const rnk = (rank || rank === 0) ? ` <span class="rnk">(${escapeHtml(rank)})</span>` : "";
        cells.push(`<td class="num" data-raw="${escapeHtml(String(val).replace(/[^0-9.+-]/g, ""))}">${escapeHtml(val)}${rnk}</td>`);
      }
      const w = Math.round((Number(r.Total) / maxTotal) * 48);
      cells.push(`<td class="total num" data-raw="${Number(r.Total) || ""}"><b>${escapeHtml(r.Total)}</b><span class="bar" style="width:${w}px"></span></td>`);
      return `<tr>${cells.join("")}</tr>`;
    }).join("");

    const styles = `
      :root { color-scheme: light; }
      body { margin:0; padding:28px 20px 60px; background:#f6f7f9; color:#111827;
             font-family: ui-sans-serif, system-ui, "Segoe UI","Noto Sans TC",Roboto,Arial; }
      .wrap { max-width:1400px; margin:0 auto; }
      h1 { font-size:18px; margin:0 0 14px; display:inline-flex; align-items:center; gap:8px; color:#111827; }
      .badge { background:#6366f1; color:#fff; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:700; letter-spacing:.04em; }
      .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 8px 20px rgba(0,0,0,.06); overflow:hidden; }
      .scroll { overflow:auto; max-height:82vh; }
      table { width:100%; border-collapse:separate; border-spacing:0; min-width:760px; }
      thead th { position:sticky; top:0; z-index:2; background:#f8fafc; color:#6b7280; text-align:right;
                 font-size:11px; letter-spacing:.03em; text-transform:uppercase; padding:11px 12px;
                 border-bottom:1px solid #e5e7eb; cursor:pointer; user-select:none; white-space:nowrap; }
      thead th.team { text-align:left; }
      thead th[data-sort="asc"]::after { content:" ▲"; } thead th[data-sort="desc"]::after { content:" ▼"; }
      tbody td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; white-space:nowrap; }
      tbody tr:nth-child(even) td { background:#fafbfc; }
      tbody tr:hover td { background:#eef2ff; }
      .num { text-align:right; font-variant-numeric:tabular-nums; }
      .rnk { color:#9ca3af; font-size:11px; }
      .team { font-weight:600; position:sticky; left:0; background:#fff; z-index:1; border-right:1px solid #eef; }
      tbody tr:nth-child(even) td.team { background:#fafbfc; }
      tbody tr:hover td.team { background:#eef2ff; }
      .rk { display:inline-flex; min-width:22px; height:22px; align-items:center; justify-content:center;
            padding:0 6px; border-radius:7px; background:#eef2ff; color:#4f46e5; font-weight:800; font-size:12px; }
      .total b { color:#111827; } .total .bar { display:inline-block; height:6px; border-radius:999px;
            background:#6366f1; margin-left:8px; vertical-align:middle; }
    `;

    const script = `
      (() => {
        const table = document.querySelector("table");
        const val = (td) => { const r = td.getAttribute("data-raw"); const n = Number(r); return (r !== "" && Number.isFinite(n)) ? n : (td.textContent || ""); };
        let st = { i:-1, dir:1 };
        document.querySelectorAll("th").forEach((th, i) => {
          th.addEventListener("click", () => {
            const tb = table.tBodies[0]; const rows = Array.from(tb.rows);
            const dir = (st.i === i) ? -st.dir : 1; st = { i, dir };
            rows.sort((a,b) => { const av=val(a.cells[i]), bv=val(b.cells[i]); if(av<bv) return -dir; if(av>bv) return dir; return 0; });
            tb.append(...rows);
            document.querySelectorAll("th").forEach(x => x.removeAttribute("data-sort"));
            th.setAttribute("data-sort", dir === 1 ? "asc" : "desc");
          });
        });
      })();
    `;

    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${styles}</style></head>
<body><div class="wrap">
  <h1><span class="badge">EXTENSION</span> ${escapeHtml(title)}</h1>
  <div class="card"><div class="scroll"><table>${thead}<tbody>${body}</tbody></table></div></div>
</div><script>${script}<\/script></body></html>`;
  }

  const api = { buildTablePage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NbaRender = api;
})(typeof window !== "undefined" ? window : this);
