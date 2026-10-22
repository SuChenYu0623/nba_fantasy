// lib/stats.js
// 共用的評分邏輯。dual-env：瀏覽器以 content script 載入後掛在 window.NbaStats，
// Node 測試以 require('../lib/stats.js') 取得。無任何相依、無 build step。
(function (root) {
  "use strict";

  // 11 個評分項目（固定順序）與 reverse 項（越少越好）
  const METRICS = ["FG%", "FT%", "3PTM", "3PT%", "PTS", "REB", "AST", "ST", "BLK", "TO", "DD"];
  const REVERSE = ["TO"];

  // 把抓下來的字串安全轉成數字；無法解析回傳 null
  function toNum(v) {
    const n = Number(String(v ?? "").replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  // min-max 正規化到 20–100；缺值→20；整欄無有效值→50；range 0→有效值 50、缺值 20
  function normalize(values, reverse = false) {
    const valid = values.filter((v) => v !== null && Number.isFinite(v));
    if (valid.length === 0) return values.map(() => 50);

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const range = max - min;
    if (range === 0) return values.map((v) => (v === null || !Number.isFinite(v)) ? 20 : 50);

    return values.map((v) => {
      if (v === null || !Number.isFinite(v)) return 20;
      const s = reverse ? (max - v) / range : (v - min) / range;
      return 20 + s * 80;
    });
  }

  // 就地為每隊加 <metric>_score、Total、Rank，回傳依 Total 由高到低排序的同一陣列
  function scoreItems(items) {
    if (!Array.isArray(items) || items.length === 0) return items;

    for (const metric of METRICS) {
      const values = items.map((t) => toNum(t[metric]));
      const scores = normalize(values, REVERSE.includes(metric));
      items.forEach((t, i) => { t[metric + "_score"] = Number(scores[i].toFixed(2)); });
    }

    items.forEach((t) => {
      const scores = METRICS.map((m) => t[m + "_score"]);
      t.Total = Number((scores.reduce((a, b) => a + b, 0) / METRICS.length).toFixed(2));
    });

    items.sort((a, b) => b.Total - a.Total);
    items.forEach((t, i) => { t.Rank = i + 1; });
    return items;
  }

  // 就地為每隊、每個 metric 加 <metric>_rank（1 起算）。依該 metric 的 _score
  // 由高到低排名（_score 已處理 reverse，故 TO 失誤少者名次在前）；平手給相同名次。
  function rankColumns(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    for (const metric of METRICS) {
      const key = metric + "_score";
      const sorted = rows
        .map((r, i) => ({ v: r[key], i }))
        .filter((d) => d.v !== null && d.v !== undefined && Number.isFinite(d.v))
        .sort((a, b) => b.v - a.v);
      let rank = 1;
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i].v !== sorted[i - 1].v) rank = i + 1;
        rows[sorted[i].i][metric + "_rank"] = rank;
      }
    }
  }

  const api = { METRICS, REVERSE, toNum, normalize, scoreItems, rankColumns };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : this).NbaStats = api;
})(typeof window !== "undefined" ? window : this);
