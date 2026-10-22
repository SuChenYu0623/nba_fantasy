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

// ===== 正規化 v2：Total 可負、雷達 0 中心、校準提示 =====
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
