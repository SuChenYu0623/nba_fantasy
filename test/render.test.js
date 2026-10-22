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
