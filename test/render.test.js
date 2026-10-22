const test = require('node:test');
const assert = require('node:assert');

// ===== 表格 fragment（heat + 發散條）與 timeAgo =====
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

const { radarDatasets, trendDatasets } = require('../lib/render.js');
test('radarDatasets：主隊 fill、比較上限內、空/越界不報錯', () => {
  const rows = [{Team:'A','PTS_score':1},{Team:'B','PTS_score':-1}];
  const ds = radarDatasets(rows, 0, [1]);
  assert.strictEqual(ds.length, 2);
  assert.strictEqual(ds[0].fill, true);
  assert.doesNotThrow(()=>radarDatasets(rows, 5, []));
  assert.doesNotThrow(()=>radarDatasets([], 0, []));
});
test('trendDatasets：focus 加粗、其餘淡', () => {
  const series = [{team:'A',totals:[1,2]},{team:'B',totals:[0,-1]}];
  const ds = trendDatasets(series, 0);
  assert.ok(ds[0].borderWidth > ds[1].borderWidth);
  assert.doesNotThrow(()=>trendDatasets(series, 9));
});
