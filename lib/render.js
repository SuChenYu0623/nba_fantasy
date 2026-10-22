// lib/render.js
// 純字串/資料函式，供頁內 Shadow DOM 儀表板使用。dual-env：瀏覽器掛在 window.NbaRender，
// Node 以 require 取得。提供表格 fragment、時間格式、雷達/趨勢的 Chart.js dataset。
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

  // ===== 表格 fragment（供注入 Shadow DOM；無 <html>、無 inline script）=====
  // heat：_score 0 → 中性；正 → 綠、負 → 紅，|score|>=2 時達最深。
  function heatBg(score) {
    const s = Number(score);
    if (!Number.isFinite(s) || s === 0) return "transparent";
    const a = (Math.min(Math.abs(s) / 2, 1) * 0.5).toFixed(2);
    return s > 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`;
  }

  function buildTableFragment(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return `<div class="nba-empty">沒有資料可顯示。</div>`;
    }
    const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.Total) || 0)), 1);

    const thead = `<thead><tr>
      <th>#</th><th class="team">Team</th>
      ${METRICS.map((m) => `<th>${escapeHtml(m)}</th>`).join("")}
      <th class="total">Total</th>
    </tr></thead>`;

    const body = rows.map((r) => {
      const cells = [];
      cells.push(`<td class="rank"><span class="rk">${escapeHtml(r.Rank)}</span></td>`);
      cells.push(`<td class="team">${escapeHtml(r.Team)}</td>`);
      for (const m of METRICS) {
        const val = r[m] ?? "";
        const rank = r[m + "_rank"];
        const rnk = (rank || rank === 0) ? ` <span class="rnk">(${escapeHtml(rank)})</span>` : "";
        cells.push(`<td class="num" style="background:${heatBg(r[m + "_score"])}">${escapeHtml(val)}${rnk}</td>`);
      }
      const t = Number(r.Total) || 0;
      const half = Math.round((Math.abs(t) / maxAbs) * 50); // 佔半軌寬的百分比
      const pos = t >= 0
        ? `left:50%;width:${half}%;background:#10b981`
        : `left:${50 - half}%;width:${half}%;background:#ef4444`;
      cells.push(`<td class="total num"><div class="dv"><span class="dv-bar" style="${pos}"></span><span class="dv-mid"></span></div><b>${escapeHtml(r.Total)}</b></td>`);
      return `<tr>${cells.join("")}</tr>`;
    }).join("");

    return `<div class="card"><div class="scroll"><table>${thead}<tbody>${body}</tbody></table></div></div>`;
  }

  function timeAgo(ts, now = Date.now()) {
    const diff = Math.max(0, now - Number(ts));
    if (diff < 60_000) return "剛剛";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
    const d = new Date(Number(ts));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  const RADAR_MAIN = "#6366f1", RADAR_CMP = ["#10b981", "#f59e0b"];
  const TREND_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#64748b", "#a855f7"];

  function radarDatasets(rows, mainIdx, compareIdxs) {
    rows = Array.isArray(rows) ? rows : [];
    const data = (r) => METRICS.map((m) => { const v = Number(r[m + "_score"]); return Number.isFinite(v) ? v : 0; });
    const out = [];
    if (!rows[mainIdx]) return out;
    out.push({ label: String(rows[mainIdx].Team ?? ""), data: data(rows[mainIdx]), fill: true,
      borderColor: RADAR_MAIN, backgroundColor: "rgba(99,102,241,.25)", borderWidth: 2, pointRadius: 2 });
    let k = 0;
    for (const i of compareIdxs || []) {
      if (i === mainIdx || !rows[i]) continue;
      const c = RADAR_CMP[k++ % RADAR_CMP.length];
      out.push({ label: String(rows[i].Team ?? ""), data: data(rows[i]), fill: false,
        borderColor: c, backgroundColor: "transparent", borderWidth: 2, borderDash: [5, 4], pointRadius: 2 });
    }
    return out;
  }

  function trendDatasets(series, focusIdx) {
    return (Array.isArray(series) ? series : []).map((s, i) => {
      const focus = i === focusIdx;
      const c = TREND_COLORS[i % TREND_COLORS.length];
      return { label: String(s.team ?? ""), data: (s.totals || []).slice(), fill: false,
        borderColor: focus ? c : c + "55", backgroundColor: c, borderWidth: focus ? 4 : 1.5,
        pointRadius: focus ? 3 : 0, tension: 0.25, order: focus ? 0 : 1 };
    });
  }

  const api = { buildTableFragment, timeAgo, radarDatasets, trendDatasets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NbaRender = api;
})(typeof window !== "undefined" ? window : this);
