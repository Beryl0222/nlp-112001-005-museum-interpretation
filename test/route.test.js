import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkbench } from '../src/workbench.js';

test('动线：两站一替补，术语随动线流动', async () => {
  const wb = await createWorkbench();
  assert.equal(wb.route.stops.length, 2);
  assert.equal(wb.route.stops[0].main.id, 'c1');
  assert.equal(wb.route.stops[0].substitutes[0].id, 'c3');
  const composed = wb.composeRoute({});
  const [first, second] = composed.stopsOut;
  assert.deepEqual(first.label.defines, ['献礼']);
  assert.ok(second.label.sentences.some((s) => s.kind === 'reference'), 'c2 对前站实物 a-11 用参见句');
});

test('联审关系来自具体的实物、主张与术语', async () => {
  const wb = await createWorkbench();
  const edges = wb.jointReview();
  assert.equal(edges.length, 1);
  const [edge] = edges;
  assert.equal(edge.from, 'c1');
  assert.equal(edge.to, 'c2');
  const kinds = edge.reasons.map((r) => r.kind);
  assert.ok(kinds.includes('item'));
  assert.ok(edge.reasons.some((r) => r.kind === 'item' && r.key === 'a-11'));
});

test('换展：替补换下主计划后，下游须补释义并重结联审', async () => {
  const wb = await createWorkbench();
  const { report, edgesAfter } = wb.swap('c3');
  const [change] = report.changedStops;
  assert.equal(change.from, 'c1');
  assert.equal(change.to, 'c3');
  assert.deepEqual(change.itemsOut.sort(), ['a-11', 'q-31']);
  assert.deepEqual(change.itemsIn, ['q-38']);
  assert.ok(report.conceptsLost.includes('献礼'));
  // a-11 不再出现于前站，c2 要补全它的介绍
  const downstream = report.downstream.find((d) => d.caseId === 'c2');
  assert.ok(downstream.addedSentences.some((s) => s.kind === 'card' && s.text.includes('ridge bowl')));
  assert.ok(report.actions.some((a) => a.action === '补释义' && /ridge bowl/.test(a.reason)));
  assert.ok(report.actions.some((a) => /献礼/.test(a.reason)));
  // 换展后 c3 与 c2 因 q-38、n2、回纹、炊审而联审
  assert.equal(edgesAfter.length, 1);
  const [edge] = edgesAfter;
  assert.equal(edge.from, 'c3');
  assert.equal(edge.to, 'c2');
  const keys = edge.reasons.map((r) => r.key);
  for (const key of ['q-38', 'n2', '回纹', '炊煮']) {
    assert.ok(keys.includes(key), `联审理由缺少 ${key}`);
  }
});

test('换展后 c2 的英文展签仍自洽：q-38 参见前站，a-11 自行介绍', async () => {
  const wb = await createWorkbench();
  const { swapped } = wb.swap('c3');
  const c2 = swapped.stopsOut[1].label;
  const reference = c2.sentences.find((s) => s.kind === 'reference');
  assert.match(reference.text, /^坡口钵/);
  const a11Card = c2.sentences.find((s) => s.kind === 'card' && s.text.includes('ridge bowl'));
  assert.equal(a11Card.decision, 'reuse');
});
