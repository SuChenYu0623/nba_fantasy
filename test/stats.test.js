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

const { toNum } = require('../lib/stats.js');
test('toNum：空字串/空白視為缺值 null（不得當成 0）', () => {
  assert.strictEqual(toNum(''), null);
  assert.strictEqual(toNum('   '), null);
  assert.strictEqual(toNum('45.6'), 45.6);
});
test('scoreItems：空值視為最差，不會壓低整欄 min', () => {
  const rows = si2([{Team:'A','PTS':'120'},{Team:'B','PTS':'80'},{Team:'C','PTS':''}]);
  const b = rows.find(r=>r.Team==='B'), c = rows.find(r=>r.Team==='C');
  assert.strictEqual(c['PTS_score'], 20); // 空值 → 最差 20
  assert.strictEqual(b['PTS_score'], 20); // 80 為有效值最小 → 20（若空值被當 0 會變 ~73）
});

// ===== 正規化 v2 =====
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
