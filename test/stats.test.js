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
