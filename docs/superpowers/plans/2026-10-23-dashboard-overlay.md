# 頁內儀表板 overlay + 效能模式開關 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把輸出從「兩個 Blob 分頁」改成「目前 Yahoo 頁面上的全幅 overlay 儀表板」（表格/雷達/趨勢三視圖、結果快取、重新整理），並加一顆「效能模式」圖片封鎖開關。

**Architecture:** 可測純邏輯放 `lib/`（趨勢重算、表格 fragment、雷達/趨勢 dataset、時間格式）；Shadow DOM overlay、Chart.js 綁定、storage I/O、lifecycle、background ruleset 切換屬 `content.js`/`background.js`（瀏覽器端，手動驗收）。Chart.js 併入 content scripts 於 isolated world 畫 Shadow DOM canvas，不開分頁、不用 CDN。正規化 v2 數學不變。

**Tech Stack:** MV3、原生 JS/CSS、無 build step；本地 `chart.umd.min.js`；`chrome.storage.local`、`chrome.declarativeNetRequest`；測試 `node --test`。

**Spec:** `docs/superpowers/specs/2026-10-23-dashboard-overlay-design.md`

## Global Constraints

- MV3、無 build step、原生 JS/CSS；overlay/啟動器用 Shadow DOM。
- 不開新分頁、不用 CDN；Chart.js 以 content script 載入，畫 Shadow DOM canvas。
- 正規化 v2（`lib/stats.js` 的 poolStats/scoreWeek/updateBaseline…）不變；爬取不變。
- 爬蟲只在「送出 / 重新整理」跑；開 overlay、切分頁、按「開啟儀表板」不重抓。
- 結果快取 `chrome.storage.local`，key `result:<leagueId>`，`rows` 存**完整 scraped item**（含 `FGM/A*`、`FTM/A*`、`3PTA*`）＋當次分數/Total＋ts；另有 `lastWeek`。
- v2 基準 `baseline:<leagueId>` 維持；兩把尺：表格/雷達用送出當下分數，趨勢用 `poolStats(當前baseline)` 重算。
- 效能模式只切圖片封鎖（`block_images` ruleset）；廣告/追蹤（`block_ads`）常開；旗標存 storage；首次預設 ON；`onInstalled`/`onStartup` 對齊。
- `blank.png` 維持 web-accessible（封圖 redirect 目標）；Chart.js 不再需要 web-accessible/`getURL`。

## Review Focus

- **趨勢重算含比率項**：rows 存了 `FGM/A*` 等 → 比率項 score 非 0；缺這些欄 → 該項 0 → 測於 Task 1。
- **跨週可比**：同一隊相同原始資料出現在不同週，趨勢重算得相同 Total（尺固定）→ 測於 Task 1。
- **發散 Total 條與 heat 邊界**：負/零 Total 不破版；缺值(_score 0)為中性色 → 測於 Task 2。
- **時間格式分桶**：剛剛 / N 分鐘 / N 小時 / 日期 → 測於 Task 2。
- **少隊/邊界 dataset**：1 隊、0 比較、focus 超出範圍不報錯 → 測於 Task 3。
- **無快取開啟**：按「開啟儀表板」而無快取 → 提示、不崩（手動，Task 5）。
- **效能模式更新後仍記得**：擴充功能更新後旗標對齊（手動，Task 4）。

---

### Task 1: 純邏輯 `trendSeries`（趨勢重算，對當前基準）

**Files:**
- Modify: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Consumes: `poolStats`、`scoreWeek`（既有 v2）。
- Produces: `trendSeries(resultCache, baseline) -> { weeks:number[], series:[{team:string, totals:(number|null)[]}] }`
  - `resultCache`：`{ [week]: { rows:[完整 item…] }, lastWeek }`（非數字 key 如 `lastWeek` 略過）。
  - 以 `stats=poolStats(baseline)` 為固定尺；對每一週，複製該週 rows → `scoreWeek(clone, stats)` → 取每隊 Total。
  - `weeks` 數字升冪；`series` 每隊對齊 weeks，缺該週為 `null`。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/stats.test.js`）

```js
const { trendSeries } = require('../lib/stats.js');
const BL = { weeks:{ '1':{ counting:{ PTS:[10,30], TO:[5,25] }, rate:{ 'FG%':[{made:40,att:100},{made:60,att:100}] } } } };
const RC = {
  lastWeek: 2,
  '1': { rows:[ {Team:'A','PTS':'30','TO':'5','FGM/A*':'60/100'}, {Team:'B','PTS':'10','TO':'25','FGM/A*':'40/100'} ] },
  '2': { rows:[ {Team:'A','PTS':'30','TO':'5','FGM/A*':'60/100'}, {Team:'B','PTS':'10','TO':'25','FGM/A*':'40/100'} ] },
};
test('trendSeries：週升冪、每隊對齊', () => {
  const t = trendSeries(RC, BL);
  assert.deepStrictEqual(t.weeks, [1,2]);
  assert.deepStrictEqual(t.series.map(s=>s.team).sort(), ['A','B']);
  assert.strictEqual(t.series[0].totals.length, 2);
});
test('跨週可比：同隊相同資料兩週 → Total 相同（尺固定）', () => {
  const t = trendSeries(RC, BL);
  const A = t.series.find(s=>s.team==='A');
  assert.strictEqual(A.totals[0], A.totals[1]);
});
test('比率項有貢獻：含 FGM/A* 時 Total 不等於純計數加總', () => {
  const t = trendSeries(RC, BL);
  const noRate = trendSeries({ '1':{ rows:[{Team:'A','PTS':'30','TO':'5'}] }, lastWeek:1 }, BL);
  assert.notStrictEqual(t.series.find(s=>s.team==='A').totals[0], noRate.series[0].totals[0]);
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（未定義）
- [ ] **Step 3: 實作 `trendSeries`** 於 `lib/stats.js`，加入 `api`。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/stats.js test/stats.test.js && git commit -m "feat(stats): trendSeries 對當前基準重算逐週 Total"`

---

### Task 2: 純邏輯 `buildTableFragment`（heat + 發散條）與 `timeAgo`

**Files:**
- Modify: `lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `METRICS`。
- Produces（加入 `NbaRender`）：
  - `buildTableFragment(rows) -> string`：表格 HTML **片段**（非完整文件、不含 inline script；供注入 Shadow DOM）。
    欄＝ Rank · Team · 11 項(原始值+小名次，cell 以 `<metric>_score` 上**好壞色階**) · Total(發散條，0 中線、右正左負)。隱藏 `_score`/複合欄；文字經跳脫。
  - `timeAgo(ts, now) -> string`：`剛剛`(<60s) / `N 分鐘前` / `N 小時前` / `M/D`（≥24h）。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/render.test.js`）

```js
const { buildTableFragment, timeAgo } = require('../lib/render.js');
function frow(team, pts, score, total, rank){ return {Rank:rank,Team:team,Total:total,'PTS':pts,'PTS_score':score,'PTS_rank':1}; }
test('buildTableFragment：heat 著色、負 Total 發散條、不含 _score 欄/複合欄', () => {
  const html = buildTableFragment([frow('A','30',1.5,-2.1,1), frow('烈焰<x>','10',-1.2,3.4,2)]);
  assert.ok(/background/.test(html));        // 有色階
  assert.ok(html.includes('-2.1'));          // 負 Total 不破版
  assert.ok(!html.includes('_score') && !html.includes('FGM/A'));
  assert.ok(html.includes('烈焰&lt;x&gt;')); // 跳脫
});
test('timeAgo 分桶', () => {
  const now = 1_000_000_000_000;
  assert.strictEqual(timeAgo(now-30_000, now), '剛剛');
  assert.ok(/分鐘前$/.test(timeAgo(now-5*60_000, now)));
  assert.ok(/小時前$/.test(timeAgo(now-3*3600_000, now)));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL
- [ ] **Step 3: 實作** `buildTableFragment`、`timeAgo`，加入 `api`。heat：由 `_score` 映射綠(高於平均)/紅(低於平均)、_score 0→中性；發散條以 `|Total|/max|Total|` 寬度、正綠右、負紅左。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/render.js test/render.test.js && git commit -m "feat(render): 表格 fragment(heat+發散條) 與 timeAgo"`

---

### Task 3: 純邏輯 `radarDatasets` / `trendDatasets`（Chart.js 資料）

**Files:**
- Modify: `lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `METRICS`。
- Produces：
  - `radarDatasets(rows, mainIdx, compareIdxs) -> object[]`：主隊 fill、比較 outline/dashed、其餘不含；讀 `<metric>_score`。
  - `trendDatasets(series, focusIdx) -> object[]`：每隊一線，focus 加粗高亮、其餘淡顯；`series` 為 `trendSeries` 的輸出。
  - 兩者對越界 index / 空輸入須不報錯。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/render.test.js`）

```js
const { radarDatasets, trendDatasets } = require('../lib/render.js');
test('radarDatasets：主隊 fill、比較上限內、空/越界不報錯', () => {
  const rows = [{Team:'A','PTS_score':1},{Team:'B','PTS_score':-1}];
  const ds = radarDatasets(rows, 0, [1]);
  assert.strictEqual(ds.length, 2);
  assert.strictEqual(ds[0].fill, true);
  assert.doesNotThrow(()=>radarDatasets(rows, 5, []));   // 越界
  assert.doesNotThrow(()=>radarDatasets([], 0, []));
});
test('trendDatasets：focus 加粗、其餘淡', () => {
  const series = [{team:'A',totals:[1,2]},{team:'B',totals:[0,-1]}];
  const ds = trendDatasets(series, 0);
  assert.ok(ds[0].borderWidth > ds[1].borderWidth);
  assert.doesNotThrow(()=>trendDatasets(series, 9));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL
- [ ] **Step 3: 實作** `radarDatasets`、`trendDatasets`，加入 `api`。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/render.js test/render.test.js && git commit -m "feat(render): 雷達/趨勢 Chart dataset 純函式"`

---

### Task 4: manifest ruleset 拆分 + background 效能模式切換/對齊

**Files:**
- Modify: `manifest.json`
- Create: `rules-images.json`, `rules-ads.json`
- Delete: `rules.json`
- Modify: `background.js`

**Interfaces:**
- Consumes: `chrome.declarativeNetRequest.updateEnabledRulesets`、`chrome.storage.local`。
- Produces: 背景行為——依 storage 旗標 `perfMode`（預設 true）啟用/停用 `block_images`；`onInstalled`/`onStartup` 對齊；接收 content.js 的切換訊息（或 `storage.onChanged`）即套用。

- [ ] **Step 1: 拆 ruleset** — 由 `rules.json` 拆出 `rules-images.json`（rule 1，圖片 redirect→`/blank.png`）與 `rules-ads.json`（rule 10/11/12），刪 `rules.json`。
- [ ] **Step 2: 改 manifest** — `declarative_net_request.rule_resources` 列兩筆：`block_images`(path rules-images.json, `enabled:true`)、`block_ads`(path rules-ads.json, `enabled:true`)；content_scripts `js` 改為 `["chart.umd.min.js","lib/stats.js","lib/render.js","content.js"]`；`web_accessible_resources` 移除 `chart.umd.min.js`、保留 `blank.png`。驗證：`node -e "JSON.parse(...manifest)"` 與兩個 rules JSON 皆 parse OK。
- [ ] **Step 3: background 切換/對齊** — `background.js`：讀 `chrome.storage.local.get('perfMode')`（undefined→true）→ `updateEnabledRulesets` 使 `block_images` 符合；註冊 `onInstalled`、`onStartup` 做同一對齊；監聽切換來源（`chrome.storage.onChanged` 的 `perfMode` 或 content.js 的 runtime message）即重新套用。驗證：`node --check background.js`。
- [ ] **Step 4: 靜態驗證** — Run: `node --check background.js && node -e "['manifest.json','rules-images.json','rules-ads.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f)))" && echo OK`　Expected: OK。
- [ ] **Step 5: 手動驗收（需人工）** — 載入擴充功能：切效能模式 OFF → 重整頁面圖片回來；ON → 圖片被擋；重載擴充功能後設定仍保留。
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(perf): 拆 ruleset、background 切換與更新對齊效能模式"`

---

### Task 5: content.js — overlay 儀表板、Chart 綁定、lifecycle、快取、效能開關 UI

**Files:**
- Modify: `content.js`
- Test: `test/stats.test.js` / `test/render.test.js`（僅在需要新純函式時）

**Interfaces:**
- Consumes: `NbaStats.{poolStats,scoreWeek,rankColumns,updateBaseline,baselineWeekCount,trendSeries}`、`NbaRender.{buildTableFragment,radarDatasets,trendDatasets,timeAgo}`、全域 `Chart`。

- [ ] **Step 1: 啟動器改造** — 角落啟動器加「開啟儀表板」鈕與「⚡ 效能模式」開關（讀/寫 `chrome.storage.local` 的 `perfMode`，變更時通知 background：寫 storage 讓 `storage.onChanged` 觸發，或送 runtime message）。
- [ ] **Step 2: overlay 外殼** — 在 Shadow DOM 建全幅 overlay（背景遮罩、中央 sheet、✕、標頭含標題/League-Week/「資料時間 X 分鐘前 · 重新整理」、分頁列 表格/雷達/趨勢、校準提示）。預設隱藏。
- [ ] **Step 3: 渲染與 Chart 綁定** — 表格頁注入 `buildTableFragment(rows)`；雷達頁用 `new Chart(shadowCanvas, {type:'radar', data:{labels:METRICS,datasets:radarDatasets(...)}, options:{…0 中心…}})`，主隊 select＋比較 chips 改寫為操作 Shadow DOM、更新 datasets；趨勢頁用 `trendDatasets(trendSeries(cache,baseline), focus)` 畫 line，聚焦 select；表格點欄排序改寫為 content.js 操作 Shadow DOM。圖表 lazy init（分頁首次顯示時建立，容器需有明確尺寸）。
- [ ] **Step 4: lifecycle + 快取** —
  - 送出/重新整理：爬蟲 → `scoreWeek`+`rankColumns` → 寫 `result:<league>`（該 week 的 `rows`=完整 item＋分數，`ts`，更新 `lastWeek`）→ `updateBaseline` 寫回 → 開 overlay 顯示該週。
  - 開啟儀表板：讀 `result:<league>`，有則顯示 `lastWeek`（不重抓），無則提示「請先送出」。
  - 「資料時間」以 `timeAgo(ts, Date.now())`；重新整理＝對 `lastWeek` 重抓。
- [ ] **Step 5: 移除 Blob 舊路** — 刪 `openTableTab`/`showInTab`/gesture-time `window.open("")` 雙開/`createObjectURL`；移除 `CHARTJS_URL=getURL(...)`（Chart 改由 content script 提供）。
- [ ] **Step 6: 靜態驗證** — Run: `node --check content.js && node --test`　Expected: content.js 語法 OK、全測試 PASS。
- [ ] **Step 7: 手動驗收（需人工）** — 送出 → overlay 就地彈出（不開分頁）、三視圖正常；關掉→按「開啟儀表板」秒開同結果（不重抓）；切分頁不重抓；「重新整理」更新資料時間；頁內跳轉後「開啟儀表板」仍有上次結果；趨勢跨週走勢正確。
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(ui): 頁內 overlay 儀表板、Chart 綁定、快取 lifecycle、移除 Blob 分頁"`

---

## Self-Review

- **Spec coverage:** §4.1 啟動器/開啟儀表板/不自動彈出→T5；§4.2 頁內渲染/Chart→T2/T3/T5；§4.3 爬取/快取/重新整理→T4(perf 無關)/T5；§4.4 趨勢兩把尺→T1/T5；§4.5 效能模式→T4(+T5 UI)。
- **Review Focus:** 趨勢含比率(T1)、跨週可比(T1)、發散條/heat 邊界(T2)、時間分桶(T2)、少隊 dataset(T3)、無快取開啟(T5 手動)、更新後記得(T4 手動) 皆有對應。
- **Types:** `trendSeries(resultCache,baseline)`、`buildTableFragment(rows)`、`timeAgo(ts,now)`、`radarDatasets(rows,mainIdx,cmp)`、`trendDatasets(series,focusIdx)` 前後一致；`result:<league>` schema 於 T4/T5 一致。
- **No-build/MV3：** 純函式皆 `node --test`；Chart/Shadow/storage/dNR 皆瀏覽器端手動驗收；Chart.js 併 content scripts、移出 web-accessible；`blank.png` 保留。
- **Proportion：** 純邏輯 T1–T3 有單元測試；T4/T5 以靜態檢查＋明列手動驗收項涵蓋不可單元測的 MV3/DOM 部分。
