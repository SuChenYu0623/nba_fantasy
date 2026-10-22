# UI 重做與輸出精簡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把擴充功能的小面板、表格頁、雷達圖頁重做成「極簡亮白」風格，表格精簡為原始數據+名次+Total+排名、隱藏 `_score` 欄，雷達圖改為「聚焦+比較」互動，並修正 TO 小名次反向的 bug。

**Architecture:** 將純邏輯（metrics 常數、評分、名次、HTML 字串產生）抽到 `lib/stats.js`、`lib/render.js` 兩個 dual-env 模組：它們在瀏覽器以 content script 身分載入（掛在全域 `NbaStats` / `NbaRender`），在 Node 以 `require()` 被測試引入。`content.js` 只保留注入面板 UI、爬蟲、送出流程，呼叫這兩個模組。輸出頁仍以「字串組 HTML → Blob URL 開新分頁」方式產生，所有腳本內嵌。

**Tech Stack:** Manifest V3 Chrome extension、原生 JS/CSS、無 build step；Chart.js（本地 `chart.umd.min.js`）；測試用 Node 內建 `node --test`（零相依）。

**Spec:** `docs/superpowers/specs/2026-10-22-ui-redesign-design.md`

## Global Constraints

- Manifest V3、**無 build step**、原生 JS/CSS；不得引入框架或打包工具。
- 不更動爬蟲 / 聯盟 id / 動態隊數邏輯（`crawlItems`、`getMatchupGroups` 不動）。
- 不做深色模式；視覺方向為亮色「極簡亮白」：底 `#f6f7f9`、白卡片、圓角 12–16px、柔和陰影、單一強調色靛藍 `#6366f1`、等寬數字、淡 zebra。
- 11 個評分項目（順序固定）：`FG%, FT%, 3PTM, 3PT%, PTS, REB, AST, ST, BLK, TO, DD`；reverse 項：`TO`。
- 表格**只顯示** 11 個評分項目，不顯示 `FGM/A*`、`FTM/A*`、`3PTA*` 複合欄，也不顯示任何 `_score` 欄。
- 隊名等文字輸出到 HTML 一律沿用跳脫（`escapeHtml` / `safeJsonForScript`）。
- 計算行為維持不變，唯一刻意變更：表格小名次改以 `_score` 排序以修正 TO 反向。

## Review Focus

- **隊數不是 12**（10、14、奇數）：評分、名次、色帶、表格、雷達都不得寫死 12 → 測於 Task 1（scoreItems）、Task 3（buildTablePage 以 N 隊）。
- **缺值 / 無法解析的數據**（`"-"`、`""`、`"45/90"` 混入）：`normalize` 視為最差（20），產頁不得崩 → 測於 Task 1。
- **同項數值相同（平手）**：小名次需給相同名次、不錯位 → 測於 Task 2。
- **隊名含 HTML 特殊字元**（`<`, `&`, `"`）：表格與雷達 JSON 需正確跳脫，不得破版/注入 → 測於 Task 3、Task 4。
- **可比較隊伍不足**（聯盟僅 2 隊，或使用者未加任何比較隊）：雷達「聚焦+比較」預設只聚焦 Rank 1，加比較上限 2、下限 0 都不得報錯 → 測於 Task 4。

---

### Task 1: 測試骨架 + `lib/stats.js`（metrics 常數、評分）

**Files:**
- Create: `package.json`
- Create: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Produces（掛在 `NbaStats`，Node 由 `require('../lib/stats.js')` 取得）：
  - `METRICS: string[]`（上列 11 項，固定順序）
  - `REVERSE: string[]`（`["TO"]`）
  - `toNum(v: any) -> number | null`
  - `normalize(values: (number|null)[], reverse?: boolean) -> number[]`（映射到 20–100；缺值→20；全列無有效值→50；range 0→有效值 50、缺值 20）
  - `scoreItems(items: object[]) -> object[]`：就地為每隊加 `"<metric>_score"`（0–100）、`Total`（11 項 score 平均）、`Rank`（依 Total 由高到低、1 起算），回傳依 Total 排序後的同一陣列。行為等同現有 `caculateItems`。

- [ ] **Step 1: 寫失敗測試** `test/stats.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { METRICS, REVERSE, normalize, scoreItems } = require('../lib/stats.js');

test('METRICS 為固定 11 項、REVERSE 為 TO', () => {
  assert.deepStrictEqual(METRICS, ["FG%","FT%","3PTM","3PT%","PTS","REB","AST","ST","BLK","TO","DD"]);
  assert.deepStrictEqual(REVERSE, ["TO"]);
});

test('normalize 缺值視為最差(20)、極值映射到 20 與 100', () => {
  const out = normalize([10, 20, null], false);
  assert.strictEqual(out[0], 20);      // min → 20
  assert.strictEqual(out[1], 100);     // max → 100
  assert.strictEqual(out[2], 20);      // 缺值 → 20
});

test('scoreItems 產生 _score / Total / Rank 並依 Total 排序', () => {
  const rows = scoreItems([
    { Team:'A', 'PTS':'100', 'TO':'5' },
    { Team:'B', 'PTS':'50',  'TO':'20' },
  ]);
  assert.ok('PTS_score' in rows[0] && 'Total' in rows[0]);
  assert.strictEqual(rows[0].Rank, 1);
  assert.ok(rows[0].Total >= rows[1].Total);
});

test('隊數非 12 也能運作（3 隊）', () => {
  const rows = scoreItems([{Team:'A','PTS':'9'},{Team:'B','PTS':'5'},{Team:'C','PTS':'1'}]);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r=>r.Rank), [1,2,3]);
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（找不到模組 `lib/stats.js`）

- [ ] **Step 3: 建 `package.json`**

```json
{ "name": "nba-fantasy-ext", "private": true, "scripts": { "test": "node --test" } }
```

- [ ] **Step 4: 實作 `lib/stats.js`** — 以 dual-env 包裝，內容為現有 `caculateItems` 的邏輯拆出 `METRICS/REVERSE/toNum/normalize/scoreItems`。檔尾：

```js
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else (typeof window !== 'undefined' ? window : this).NbaStats = api;
```

- [ ] **Step 5: 執行確認通過** — Run: `node --test`　Expected: PASS

- [ ] **Step 6: Commit** — `git add package.json lib/stats.js test/stats.test.js && git commit -m "feat(stats): 抽出共用 metrics 與評分模組 + 測試"`

---

### Task 2: `rankColumns`（reverse-aware 小名次，修正 TO）

**Files:**
- Modify: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Consumes: `METRICS`（Task 1）、各隊的 `"<metric>_score"`（由 `scoreItems` 產生）。
- Produces: `rankColumns(rows: object[]) -> void`：就地為每隊、每個 metric 加 `"<metric>_rank"`（1 起算；依該 metric 的 `_score` 由高到低，因 `_score` 已處理 reverse，故 TO 失誤少者名次在前）；平手給相同名次。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/stats.test.js`）

```js
const { scoreItems: si2, rankColumns } = require('../lib/stats.js');
test('rankColumns：TO 失誤少者小名次在前（修正反向）', () => {
  const rows = si2([
    { Team:'Low', 'TO':'5'  },   // 失誤少 → 應 rank 1
    { Team:'High','TO':'20' },
  ]);
  rankColumns(rows);
  const low = rows.find(r=>r.Team==='Low');
  assert.strictEqual(low['TO_rank'], 1);
});
test('rankColumns：平手給相同名次', () => {
  const rows = si2([{Team:'A','PTS':'10'},{Team:'B','PTS':'10'},{Team:'C','PTS':'1'}]);
  rankColumns(rows);
  const a = rows.find(r=>r.Team==='A'), b = rows.find(r=>r.Team==='B');
  assert.strictEqual(a['PTS_rank'], b['PTS_rank']);
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（`rankColumns` 未定義）

- [ ] **Step 3: 實作 `rankColumns(rows)`** 於 `lib/stats.js` 並加入 `api`：對每個 `METRICS` 以 `item[metric + "_score"]` 由高到低排名、平手同名次。

- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS

- [ ] **Step 5: Commit** — `git add lib/stats.js test/stats.test.js && git commit -m "feat(stats): reverse-aware 小名次，修正 TO 反向"`

---

### Task 3: `lib/render.js` — `buildTablePage`（A 風格、精簡欄位）

**Files:**
- Create: `lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `METRICS`（Task 1）；rows 已經過 `scoreItems` + `rankColumns`（含 `<metric>`, `<metric>_rank`, `Total`, `Rank`）。
- Produces（掛在 `NbaRender` / Node require）：`buildTablePage(rows: object[], opts?: {title?: string}) -> string`：回傳完整自含 HTML 字串。欄位＝`Rank · Team · <11 metrics 原始值(各附小名次) · Total`；**不含** `_score` 與 `FGM/A*`/`FTM/A*`/`3PTA*`；A 風格 CSS；保留點表頭排序的內嵌 script；所有文字經 `escapeHtml`。

- [ ] **Step 1: 寫失敗測試** `test/render.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { scoreItems, rankColumns } = require('../lib/stats.js');
const { buildTablePage } = require('../lib/render.js');

function sample() {
  const rows = scoreItems([
    { Team:'蒼鷹', 'PTS':'100','TO':'5','FGM/A*':'45/90' },
    { Team:'烈焰<x>', 'PTS':'50','TO':'20','FGM/A*':'30/80' },
  ]);
  rankColumns(rows);
  return rows;
}

test('只含 11 個評分項目，不含 _score 與複合欄', () => {
  const html = buildTablePage(sample());
  for (const m of ["FG%","PTS","REB","TO","DD"]) assert.ok(html.includes(`>${m}<`) || html.includes(m));
  assert.ok(!html.includes('_score'));
  assert.ok(!html.includes('FGM/A'));
});
test('含 Rank / Total 欄', () => {
  const html = buildTablePage(sample());
  assert.ok(html.includes('Total'));
});
test('隊名特殊字元有跳脫', () => {
  const html = buildTablePage(sample());
  assert.ok(!html.includes('烈焰<x>'));
  assert.ok(html.includes('烈焰&lt;x&gt;'));
});
test('保留排序 script', () => {
  assert.ok(buildTablePage(sample()).includes('addEventListener'));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（`lib/render.js` 不存在）

- [ ] **Step 3: 實作 `buildTablePage(rows, opts)`** 於 `lib/render.js`（dual-env）：欄位固定為 `["Rank","Team",...METRICS,"Total"]`；每格顯示 `rows[i][col]`，metric 欄附 `(rows[i][col+"_rank"])`；`Rank` 用靛藍徽章、`Total` 粗體+迷你條；CSS 套 A 風格（白卡片、sticky 表頭、淡 zebra、Team sticky 置左、等寬數字）；沿用 `escapeHtml` 與點表頭排序 script；色帶若需要以 `rows.length` 動態產生。

- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS

- [ ] **Step 5: Commit** — `git add lib/render.js test/render.test.js && git commit -m "feat(render): A 風格精簡表格頁"`

---

### Task 4: `lib/render.js` — `buildRadarPage`（聚焦+比較）

**Files:**
- Modify: `lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `METRICS`（Task 1）；`data: object[]`（每隊含 `Team` 與 11 個 `<metric>_score` 值，依 Rank 排序，index 0 為 Rank 1）；`chartjsUrl: string`（由 content.js 以 `chrome.runtime.getURL("chart.umd.min.js")` 提供）。
- Produces: `buildRadarPage(data: object[], chartjsUrl: string) -> string`：完整自含 HTML。內嵌 Chart.js（`<script src="${chartjsUrl}">`）、內嵌 `data`（經 `safeJsonForScript`）、A 風格；控制列：主隊選擇器（預設 `data[0]`＝Rank 1，實心填色）＋加入比較（≤2 隊、外框/虛線）＋未選取者不繪製；切換時重建 datasets，不依賴 Chart.js 預設圖例。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/render.test.js`）

```js
const { buildRadarPage } = require('../lib/render.js');
const RD = [
  { Team:'蒼鷹', 'PTS_score':90,'TO_score':80 },
  { Team:'烈焰', 'PTS_score':50,'TO_score':40 },
];
test('雷達頁含 Chart.js 與資料、預設聚焦 Rank 1', () => {
  const html = buildRadarPage(RD, 'chart.js');
  assert.ok(html.includes('chart.js'));
  assert.ok(html.includes('蒼鷹'));          // 內嵌資料
  assert.ok(html.includes('radar'));          // Chart.js radar 設定
});
test('僅 1 隊也不報錯（下限 0 比較）', () => {
  assert.doesNotThrow(() => buildRadarPage([RD[0]], 'chart.js'));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（`buildRadarPage` 未定義）

- [ ] **Step 3: 實作 `buildRadarPage(data, chartjsUrl)`** 於 `lib/render.js`：labels＝`METRICS`；內嵌控制 JS 以 `data[0]` 為預設主隊、提供加入/移除比較（上限 2），每次變更重建 `chart.data.datasets` 並 `chart.update()`；主隊 fill、比較 outline/dashed、其餘不加入；`cleanValue` 沿用（非數值→0）。

- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS

- [ ] **Step 5: Commit** — `git add lib/render.js test/render.test.js && git commit -m "feat(render): 聚焦+比較雷達圖頁"`

---

### Task 5: 接線 content.js + manifest，並重做面板外觀（A 風格）

**Files:**
- Modify: `content.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: `NbaStats.scoreItems` / `NbaStats.rankColumns`（Task 1,2）、`NbaRender.buildTablePage` / `NbaRender.buildRadarPage`（Task 3,4）。

- [ ] **Step 1: manifest 載入模組** — 將 `content_scripts[0].js` 改為 `["lib/stats.js","lib/render.js","content.js"]`（順序不可反）。驗證：`node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`。

- [ ] **Step 2: content.js 改用模組** — 移除就地的 `caculateItems`、`buildHtmlPage`、`buildRadarChart`、`addRanksToRows`、寫死的 `colors` 陣列；送出流程改呼叫 `NbaStats.scoreItems` → `NbaStats.rankColumns` → `NbaRender.buildTablePage` 與 `NbaRender.buildRadarPage`（後者傳入 `CHARTJS_URL` 與含 `_score` 的資料）。`escapeHtml` / `safeJsonForScript` 移入 `lib/render.js` 內部使用。

- [ ] **Step 3: 面板重做為 A 風格** — 更新 Shadow DOM 內的 `style`：白色圓角卡片、標題列含靛藍小圓點+標題、藥丸輸入框、靛藍送出鈕、精緻進度條；保留拖曳、關閉、Shadow DOM、送出/進度邏輯。

- [ ] **Step 4: 靜態驗證** — Run: `node --check content.js && node --test`　Expected: content.js 語法 OK、全部測試 PASS。

- [ ] **Step 5: 手動驗收（需人工）** — reload 擴充功能 → 開 league 頁 → 輸入 week 送出：確認面板/表格/雷達三者 A 風格一致；表格只有 11 項+名次+Total+Rank、無 `_score`/複合欄；TO 名次正確（失誤少者在前）；雷達預設聚焦 Rank 1、可加減比較、其餘隱藏。

- [ ] **Step 6: Commit** — `git add content.js manifest.json && git commit -m "refactor: 接上 stats/render 模組並重做面板為 A 風格"`

---

## Self-Review

- **Spec coverage:** §4.1 風格→Task 3/4/5；§4.2 面板→Task 5;§4.3 表格精簡+小名次+TO 修正→Task 2/3；§4.4 雷達聚焦+比較→Task 4；§4.5 metrics DRY+TO 修正例外→Task 1/2。皆有對應。
- **Review Focus:** 隊數非 12（T1/T3）、缺值（T1）、平手（T2）、特殊字元跳脫（T3/T4）、比較隊不足（T4）皆有測試。
- **Types:** `NbaStats`/`NbaRender` API 名稱於各 Interfaces 區一致；`buildRadarPage(data, chartjsUrl)`、`buildTablePage(rows, opts)` 前後一致。
- **No-build 約束:** dual-env 模組 + `node --test`，無相依、無打包。
