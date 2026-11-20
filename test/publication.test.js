import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkbench } from '../src/workbench.js';

test('发布：暂缓句留在编辑端，有依据的介绍照常发布', async () => {
  const wb = await createWorkbench();
  const version = wb.publish('c1', { by: '策展员甲', note: '首版' });
  assert.equal(version.n, 1);
  assert.ok(version.withheld.length >= 2, '译句与容量暂缓句留在编辑端');
  assert.ok(version.withheld.some((w) => /译文冲突未决/.test(w.reason)));
  assert.doesNotMatch(version.text, /确证用于献礼/, '译稿断言句不得发布');
  assert.match(version.text, /也许用于献礼/, '原手记推测句照常发布');
});

test('观众视图：当前生效文字与可公开出处，涉冲突译文不公开', async () => {
  const wb = await createWorkbench();
  wb.publish('c1', { by: '策展员甲' });
  const view = wb.visitorView('c1');
  assert.equal(view.version, 1);
  const records = view.sources.map((s) => s.record);
  assert.ok(records.includes('q-31'));
  assert.ok(records.includes('n1'));
  assert.ok(!records.includes('n4'), '涉未决冲突的译稿不出现在公开出处');
  assert.equal(wb.visitorView('c2'), null, '未发布的展柜没有观众视图');
});

test('研究员回看：版本记录当时的判定与未决冲突', async () => {
  const wb = await createWorkbench();
  wb.publish('c1', { by: '策展员甲', note: '首版，译句暂缓' });
  wb.publish('c1', { by: '策展员乙', note: '再版，维持判定' });
  const history = wb.history('c1');
  assert.equal(history.length, 2);
  assert.equal(history[0].note, '首版，译句暂缓');
  assert.deepEqual(history[0].openConflicts, [wb.getConflicts()[0].id]);
  assert.ok(history[0].withheld.every((w) => w.reason));
});

test('没有可发布句的展柜不得发布', async () => {
  const wb = await createWorkbench();
  const label = wb.composeCase('c1');
  for (const s of label.sentences) s.decision = 'defer';
  assert.throws(
    () => wb.publications.publish(label, { by: '测试', claimsById: new Map(), conflicts: [] }),
    /没有可发布的句子/,
  );
});
