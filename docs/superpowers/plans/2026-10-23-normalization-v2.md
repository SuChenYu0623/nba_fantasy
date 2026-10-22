# 正規化 v2（跨週可比戰力值）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把正規化從當週 min-max 換成「對持久化滾動基準做 volume-weighted robust z-score」，讓 Total 成為跨週可比的戰力值（0＝平均、正為高於平均）。

**Architecture:** 純數學全放 `lib/stats.js`（dual-env，可被 `node --test`）：robust 統計、比率解析、`poolStats`（由基準算量尺）、`scoreWeek`（對量尺計分）、`updateBaseline`（把一週併入基準）。`chrome.storage.local` 的讀寫只在 `content.js`：載入該 league 基準 → 以「先前池」算量尺（空則 bootstrap 用當週）→ `scoreWeek` → 顯示 → `updateBaseline` 存回。表格/雷達沿用 v1，只調整 Total 條與雷達軸、加校準提示。

**Tech Stack:** MV3、原生 JS/CSS、無 build step；`chrome.storage.local`（權限已具備）；測試 `node --test`。

**Spec:** `docs/superpowers/specs/2026-10-22-normalization-v2-design.md`

## Global Constraints

- MV3、無 build step、原生 JS/CSS；lib 為 dual-env 模組（`NbaStats`/`NbaRender`）。
- 11 項（固定順序）：`FG%, FT%, 3PTM, 3PT%, PTS, REB, AST, ST, BLK, TO, DD`；reverse：`TO`。
- 比率項 `FG%, FT%, 3PT%`：volume-weighted；其餘 8 項為計數項。
- 比率來源：`FG%`←`FGM/A*`（made/att，如 `51/118`）；`FT%`←`FTM/A*`；`3PT%`← made 取 `3PTM`、att 取 `3PTA*`（如 `39`）。百分比以 makes/attempts 直接算，不用 `.432` 欄。
- 聯盟比率＝出手量加權 `Σmakes/Σattempts`。
- robust：`center=中位數`、`spread=MAD`；`MAD=0 → 該項 score 記 0`。
- 缺值/無法解析：該項 score 記 **中性 0**；且該 per-team 樣本 **排除於基準池外**。
- 基準存 `chrome.storage.local`，以 **leagueId** 為 key；內部以 **week 為 key**；重跑同一週 **取代**；**整季累積、不設上限**。
- 當週對「**先前池（排除當週）**」計分；先前池為空時 **bootstrap** 用當週自身。
- `Total = 11 項 score 加總`。表格/雷達/欄位沿用 v1（只調 Total 條與雷達軸、加校準提示）。

## Review Focus

- **跨週可比性（核心）**：量尺固定時，同一隊的同一組輸入必得同一組分數，不受當週其他隊影響 → 測於 Task 2。
- **volume weighting**：同百分比、出手量較高者 |impact| 與分數較大 → 測於 Task 2。
- **缺值→中性 0**（非最差），且**排除於池外**（不拉動中位數/MAD/聯盟比率）→ 測於 Task 2（計分）、Task 3（池）。
- **MAD=0 不除以 0**（score 記 0）→ 測於 Task 2。
- **重跑同一週取代、不雙計**；跨週累積正確 → 測於 Task 3。

---

### Task 1: robust 統計與比率解析 helpers

**Files:**
- Modify: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Produces（加入 `NbaStats`）：
  - `median(nums: number[]) -> number | null`（空→null；偶數取中間兩數平均）
  - `mad(nums: number[]) -> number`（`median(|x − median(x)|)`；空→0）
  - `parseRatio(s: string) -> { made: number, att: number } | null`（`"51/118"`→`{made:51,att:118}`；無法解析→null）
  - `RATE_METRICS: string[]` = `["FG%","FT%","3PT%"]`
  - `COUNTING_METRICS: string[]`（其餘 8 項，含 TO）
  - `RATE_SOURCES`：`{ "FG%":{ratioKey:"FGM/A*"}, "FT%":{ratioKey:"FTM/A*"}, "3PT%":{madeKey:"3PTM", attKey:"3PTA*"} }`

- [ ] **Step 1: 寫失敗測試**（附加於 `test/stats.test.js`）

```js
const { median, mad, parseRatio, RATE_METRICS, COUNTING_METRICS } = require('../lib/stats.js');
test('median / mad', () => {
  assert.strictEqual(median([10,20,30]), 20);
  assert.strictEqual(mad([10,20,30]), 10);        // |−10|,0,|10| → median=10
  assert.strictEqual(median([]), null);
});
test('parseRatio', () => {
  assert.deepStrictEqual(parseRatio('51/118'), { made:51, att:118 });
  assert.strictEqual(parseRatio('—'), null);
});
test('metric 分組', () => {
  assert.deepStrictEqual(RATE_METRICS, ["FG%","FT%","3PT%"]);
  assert.ok(!COUNTING_METRICS.includes("FG%") && COUNTING_METRICS.includes("TO"));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（未定義）
- [ ] **Step 3: 實作** `median`、`mad`、`parseRatio`、`RATE_METRICS`、`COUNTING_METRICS`、`RATE_SOURCES` 並加入 `api`。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/stats.js test/stats.test.js && git commit -m "feat(stats): robust 統計與比率解析 helpers"`

---

### Task 2: `poolStats` + `scoreWeek`（對基準計分）

**Files:**
- Modify: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Consumes: Task 1 的 helpers、`METRICS`/`REVERSE`。
- Produces:
  - `poolStats(baseline) -> { counting: {[m]: {median, mad}}, rate: {[m]: {leagueRate, median, mad}} }`
    （`baseline` 形如 `{ weeks: { [week]: WeekSample } }`，見 Task 3；pool 為所有週樣本彙整。
    rate：`leagueRate=Σmade/Σatt`，impacts=`(made/att − leagueRate)*att`，取其 median/mad。）
  - `scoreWeek(items, stats) -> items`：就地為每隊加 `<metric>_score`、`Total`、`Rank`，依 Total 由高到低排序。
    計數項 `score=(v − median)/mad`（TO 取負）；比率項 `score=(impact − median)/mad`，`impact=(teamRate − leagueRate)*att`。
    缺值/無法解析→score 0；`mad===0`→score 0；`Total=Σ 11 score`。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/stats.test.js`）

```js
const { poolStats, scoreWeek } = require('../lib/stats.js');
// 固定基準：PTS pool [10,20,30] → median 20, mad 10；FG% 兩隊 40/100、60/100 → leagueRate .5, impacts ∓10, mad 10
const BASE = { weeks: { '1': {
  counting: { PTS:[10,20,30], TO:[10,20,30] },
  rate: { 'FG%':[{made:40,att:100},{made:60,att:100}] }
} } };
test('計數項 robust z（PTS=30 → +1）', () => {
  const s = poolStats(BASE);
  const rows = scoreWeek([{Team:'A','PTS':'30'}], s);
  assert.strictEqual(rows[0]['PTS_score'], 1);
});
test('TO 取負（TO 少 → 正分）', () => {
  const s = poolStats(BASE);
  const rows = scoreWeek([{Team:'A','TO':'10'}], s);
  assert.strictEqual(rows[0]['TO_score'], 1);   // (10−20)/10=−1 → 取負 → +1
});
test('volume weighting：同%、出手量加倍 → 分數加倍', () => {
  const s = poolStats(BASE);
  const lo = scoreWeek([{Team:'A','FGM/A*':'60/100'}], s)[0]['FG%_score'];
  const hi = scoreWeek([{Team:'A','FGM/A*':'120/200'}], s)[0]['FG%_score'];
  assert.ok(hi > lo && Math.abs(hi - 2*lo) < 1e-9);
});
test('缺值→中性 0；MAD=0→0', () => {
  const s = poolStats(BASE);
  assert.strictEqual(scoreWeek([{Team:'A','PTS':''}], s)[0]['PTS_score'], 0);
  const flat = poolStats({ weeks:{'1':{counting:{PTS:[5,5,5]},rate:{}}} });
  assert.strictEqual(scoreWeek([{Team:'A','PTS':'5'}], flat)[0]['PTS_score'], 0);
});
test('跨週可比：量尺固定時，A 的分數不受同週其他隊影響', () => {
  const s = poolStats(BASE);
  const a1 = scoreWeek([{Team:'A','PTS':'30'},{Team:'B','PTS':'10'}], s).find(r=>r.Team==='A')['PTS_score'];
  const a2 = scoreWeek([{Team:'A','PTS':'30'},{Team:'C','PTS':'25'}], s).find(r=>r.Team==='A')['PTS_score'];
  assert.strictEqual(a1, a2);
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL（未定義）
- [ ] **Step 3: 實作** `poolStats` 與 `scoreWeek`，加入 `api`。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/stats.js test/stats.test.js && git commit -m "feat(stats): poolStats + scoreWeek（volume-weighted robust z）"`

---

### Task 3: 基準樣本與更新（`buildWeekSample` / `updateBaseline` / `baselineWeekCount`）

**Files:**
- Modify: `lib/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Consumes: Task 1 helpers、`COUNTING_METRICS`/`RATE_METRICS`/`RATE_SOURCES`。
- Produces:
  - `buildWeekSample(items) -> WeekSample`：`{ counting:{[m]:number[]}, rate:{[m]:{made,att}[]} }`；
    **無法解析/缺值的 per-team 值不納入**（陣列可短於隊數）。
  - `updateBaseline(baseline, items, week) -> baseline`：回傳新 baseline，`weeks[String(week)] = buildWeekSample(items)`（**取代**該週）。
  - `baselineWeekCount(baseline) -> number`。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/stats.test.js`）

```js
const { buildWeekSample, updateBaseline, baselineWeekCount } = require('../lib/stats.js');
test('buildWeekSample：缺值排除於池外', () => {
  const s = buildWeekSample([{Team:'A','PTS':'10'},{Team:'B','PTS':''}]);
  assert.deepStrictEqual(s.counting.PTS, [10]);   // B 的空值不納入
});
test('updateBaseline：重跑同一週取代、不雙計', () => {
  let b = { weeks:{} };
  b = updateBaseline(b, [{Team:'A','PTS':'10'}], 5);
  b = updateBaseline(b, [{Team:'A','PTS':'99'}], 5);  // 同一週再跑
  assert.strictEqual(baselineWeekCount(b), 1);
  assert.deepStrictEqual(b.weeks['5'].counting.PTS, [99]); // 取代，非 [10,99]
});
test('updateBaseline：不同週累積', () => {
  let b = { weeks:{} };
  b = updateBaseline(b, [{Team:'A','PTS':'10'}], 1);
  b = updateBaseline(b, [{Team:'A','PTS':'20'}], 2);
  assert.strictEqual(baselineWeekCount(b), 2);
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL
- [ ] **Step 3: 實作** 三個函式，加入 `api`。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/stats.js test/stats.test.js && git commit -m "feat(stats): 基準樣本與週累積更新"`

---

### Task 4: `render.js` 調整（Total 條容負值、雷達 0 中心、校準提示）

**Files:**
- Modify: `lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: rows（含 `<metric>`、`<metric>_rank`、`Total`、`Rank`，Total 可為負）。
- Produces（簽章調整）：
  - `buildTablePage(rows, opts?: {title?, weeks?}) -> string`：Total 迷你條改以 **|Total| 相對該週最大 |Total|** 縮放（負值不破版）；`opts.weeks` 有給且偏小時，頁面顯示校準提示文字（含週數）。
  - `buildRadarPage(data, chartjsUrl, opts?: {weeks?}) -> string`：雷達軸改為 **以 0 為中心、依資料動態**（不再寫死 `suggestedMax:100`）。

- [ ] **Step 1: 寫失敗測試**（附加於 `test/render.test.js`）

```js
test('表格：負 Total 不破版、校準提示顯示週數', () => {
  const rows = [{Rank:1,Team:'A',Total:-3.2,'PTS':'5','PTS_rank':1}];
  const html = buildTablePage(rows, { title:'T', weeks:2 });
  assert.ok(html.includes('-3.2'));
  assert.ok(/校準/.test(html) && html.includes('2'));
});
test('雷達：不再寫死 suggestedMax 100', () => {
  const html = buildRadarPage([{Team:'A','PTS_score':1.2}], 'chart.js', { weeks: 5 });
  assert.ok(!html.includes('suggestedMax: 100') && !html.includes('suggestedMax:100'));
});
```

- [ ] **Step 2: 執行確認失敗** — Run: `node --test`　Expected: FAIL
- [ ] **Step 3: 實作** Total 條縮放改為 `|Total|/max|Total|`、加校準提示（`weeks` 小於門檻如 3 時顯示「基準校準中：已累積 N 週」）、雷達軸改以 0 為中心動態範圍（如 `±max(|score|)`，`legend` 維持關閉）。
- [ ] **Step 4: 執行確認通過** — Run: `node --test`　Expected: PASS
- [ ] **Step 5: Commit** — `git add lib/render.js test/render.test.js && git commit -m "feat(render): Total 條容負值、雷達 0 中心、校準提示"`

---

### Task 5: 接線 `content.js`（storage 流程）＋ 移除 v1 min-max

**Files:**
- Modify: `content.js`
- Modify: `lib/stats.js`（移除舊 `normalize`、舊 `scoreItems`）
- Modify: `test/stats.test.js`（移除/改寫 min-max 專屬測試）

**Interfaces:**
- Consumes: `NbaStats.{poolStats,scoreWeek,updateBaseline,buildWeekSample,baselineWeekCount,rankColumns}`、`NbaRender.{buildTablePage,buildRadarPage}`。

- [ ] **Step 1: 移除 v1 min-max 並清理測試** — 刪 `lib/stats.js` 的舊 `normalize` 與舊 `scoreItems`；刪 `test/stats.test.js` 中針對 min-max 的測試（`normalize 缺值…20/100`、`scoreItems 產生…`、`隊數非 12`、以及依賴舊 `scoreItems` 的 `rankColumns`/空值 兩個 setup——改用 `scoreWeek(…, poolStats(…))` 重建這些 setup）。確認 `rankColumns` 仍以 `_score` 排名、其行為測試改用新計分路徑。
- [ ] **Step 2: 執行確認（紅/綠轉換）** — Run: `node --test`　Expected: 僅剩新模型測試、全數 PASS（舊 min-max 測試已移除）。
- [ ] **Step 3: 接線 `content.js`** —
  `crawlItems` 回傳（或另算）`leagueId`；送出流程改為：
  `chrome.storage.local.get` 取該 `leagueId` 的 baseline（無則 `{weeks:{}}`）→
  以「排除當週」的 baseline 算 `stats=poolStats(prior)`；若 `baselineWeekCount(prior)===0` 則 **bootstrap**：`stats=poolStats(updateBaseline(prior, items, week))` →
  `scoreWeek(items, stats)` → `rankColumns(items)` →
  `openTableTab(items, {title, weeks: baselineWeekCount(prior)})`（表格與雷達帶 weeks）→
  `updateBaseline` 後 `chrome.storage.local.set` 存回（key 以 leagueId 命名）。
- [ ] **Step 4: 靜態驗證** — Run: `node --check content.js && node -e "JSON.parse(require('fs').readFileSync('manifest.json'))" && node --test`　Expected: 語法 OK、JSON OK、全測試 PASS。
- [ ] **Step 5: 手動驗收（需人工）** — reload 擴充功能 → 連續跑 week 1、week 2：確認 Total 為可正可負的戰力值、第 1 週顯示「校準中」、雷達軸以 0 為中心、重跑同一週數字不因雙計而漂移。
- [ ] **Step 6: Commit** — `git add content.js lib/stats.js test/stats.test.js && git commit -m "refactor: 接上基準 storage 流程，移除 v1 min-max 正規化"`

---

## Self-Review

- **Spec coverage:** §4.1 方法→T1/T2；§4.2 基準/週 key/取代/累積→T2/T3/T5；§4.3 呈現（Total 條、雷達軸、校準提示）→T4/T5；§4.4 架構（純函式 vs storage 在 content.js）→T2/T3/T5；§8 已驗證格式→T1 RATE_SOURCES/parseRatio。
- **Review Focus:** 跨週可比(T2)、volume weighting(T2)、缺值→0 且排除(T2/T3)、MAD=0(T2)、重跑取代/累積(T3) 皆有測試。
- **Types:** `baseline={weeks:{[week]:WeekSample}}`、`poolStats(baseline)`、`scoreWeek(items,stats)`、`updateBaseline(baseline,items,week)`、`buildTablePage(rows,{title,weeks})`、`buildRadarPage(data,chartjsUrl,{weeks})` 前後一致。
- **No-build：** 僅新增純函式與測試；storage I/O 侷限於 content.js；無打包。
- **移除對稱性：** v1 min-max（`normalize`/舊 `scoreItems`）與其測試在 T5 一併移除，避免遺留死碼與矛盾測試。
