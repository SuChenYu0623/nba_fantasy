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

const { poolStats, scoreWeek } = require('../lib/stats.js');
const BASE = { weeks: { '1': {
  counting: { PTS:[10,20,30], TO:[10,20,30] },
  rate: { 'FG%':[{made:40,att:100},{made:60,att:100}] }
} } };
test('計數項 robust z（PTS=30 → +1）', () => {
  const rows = scoreWeek([{Team:'A','PTS':'30'}], poolStats(BASE));
  assert.strictEqual(rows[0]['PTS_score'], 1);
});
test('TO 取負（TO 少 → 正分）', () => {
  const rows = scoreWeek([{Team:'A','TO':'10'}], poolStats(BASE));
  assert.strictEqual(rows[0]['TO_score'], 1);   // (10−20)/10=−1 → 取負 → +1
});
test('volume weighting：同%、出手量加倍 → 分數加倍', () => {
  const s = poolStats(BASE);
  const lo = scoreWeek([{Team:'A','FGM/A*':'60/100'}], s)[0]['FG%_score'];
  const hi = scoreWeek([{Team:'A','FGM/A*':'120/200'}], s)[0]['FG%_score'];
  assert.ok(hi > lo && Math.abs(hi - 2*lo) < 1e-9);
});
test('缺值→中性 0；MAD=0→0', () => {
  assert.strictEqual(scoreWeek([{Team:'A','PTS':''}], poolStats(BASE))[0]['PTS_score'], 0);
  const flat = poolStats({ weeks:{'1':{counting:{PTS:[5,5,5]},rate:{}}} });
  assert.strictEqual(scoreWeek([{Team:'A','PTS':'5'}], flat)[0]['PTS_score'], 0);
});
test('跨週可比：量尺固定時，A 的分數不受同週其他隊影響', () => {
  const s = poolStats(BASE);
  const a1 = scoreWeek([{Team:'A','PTS':'30'},{Team:'B','PTS':'10'}], s).find(r=>r.Team==='A')['PTS_score'];
  const a2 = scoreWeek([{Team:'A','PTS':'30'},{Team:'C','PTS':'25'}], s).find(r=>r.Team==='A')['PTS_score'];
  assert.strictEqual(a1, a2);
});

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
