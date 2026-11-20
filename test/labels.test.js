import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkbench } from '../src/workbench.js';
import { composeLabel } from '../src/labels.js';

test('c1：原手记推测句可沿用，译稿断言句暂缓，限定语都在', async () => {  const wb = await createWorkbench();
  const label = wb.composeCase('c1');
  const byKind = (kind) => label.sentences.filter((s) => s.kind === kind);
  const note = label.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n1#')));
  assert.equal(note.decision, 'reuse');
  assert.match(note.text, /也许/);
  assert.match(note.text, /不能从埋放位置确定/);
  const translation = label.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n4#')));
  assert.equal(translation.decision, 'defer');
  assert.match(translation.reason, /译文冲突未决/);
  assert.ok(label.publishableLength <= 100);
  assert.ok(byKind('card').every((s) => s.decision === 'reuse'));
  // 发布文本保留所有限定：约、疑似、也许、不能、不详
  for (const token of ['约', '疑似', '也许', '不能', '不详']) {
    assert.ok(label.publishableText.includes(token), `缺少限定语 ${token}`);
  }
});

test('c2：英文展签按词计容量，比较句带出处，前站实物用参见句', async () => {
  const wb = await createWorkbench();
  const label = wb.composeCase('c2');
  assert.equal(label.measure, 'word');
  const comparison = label.sentences.find((s) => s.kind === 'comparison');
  assert.equal(comparison.decision, 'sourced-comparison');
  assert.match(comparison.text, /per 雪线馆/);
  assert.match(comparison.text, /may have held grain/);
  const reference = label.sentences.find((s) => s.kind === 'reference');
  assert.ok(reference, 'a-11 在前站展出过，应有参见句');
  // c1 因容量暂缓了 n3，c2 必须自己补上这句
  const n3 = label.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n3#')));
  assert.equal(n3.decision, 'reuse');
  assert.match(n3.text, /without direct evidence/);
});

test('c3：简版只删出处前缀，类型级限定"另一个同类钵没有测"保留', async () => {
  const wb = await createWorkbench();
  const label = wb.composeCase('c3');
  assert.ok(label.publishableLength <= 55);
  const note = label.sentences.find((s) => s.kind === 'claim');
  assert.equal(note.decision, 'reuse');
  assert.match(note.text, /另一个同类钵没有测/);
  assert.doesNotMatch(note.text, /据考古协作方/);
  assert.ok(label.issues.some((i) => i.kind === 'shortened'));
});

test('不能拿另一展柜的签认来补证：各柜句子只用自己的依据', async () => {
  const wb = await createWorkbench();
  const c2 = wb.composeCase('c2');
  const note = c2.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n2#')));
  assert.deepEqual(note.sources.map((s) => s.record), ['n2', 'n2']);
  // 发布 c1 不影响 c2 的判定
  wb.publish('c1', { by: '测试' });
  const c2After = wb.composeCase('c2');
  const noteAfter = c2After.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n2#')));
  assert.equal(noteAfter.decision, note.decision);
  assert.deepEqual(noteAfter.sources.map((s) => s.record), ['n2', 'n2']);
});

test('术语表：释义来自资料原文，涉冲突译文不作依据', async () => {
  const wb = await createWorkbench();
  const glossary = wb.getGlossary();
  assert.equal(glossary['献礼'].zh.gloss, '该钵也许用于献礼');
  assert.equal(glossary['献礼'].en, null, 'n4 译文涉冲突，不能作英文释义依据');
  assert.ok(glossary['仪式'].en.gloss.includes('without direct evidence'));
});

test('极限容量：争议双方都在的句子不得删，超限如实上报', async () => {
  const wb = await createWorkbench();
  const plan = { id: 'cx', stop: '测试', language: 'zh', items: 'q-31', itemIds: ['q-31'], limitNumber: 30 };
  const label = composeLabel(plan, {
    claims: wb.getClaims(),
    conflicts: wb.getConflicts(),
    registry: wb.registry,
    glossary: wb.getGlossary(),
    route: { upstreamItems: new Set(), upstreamConcepts: new Set(), laterItems: new Set() },
  });
  const dispute = label.sentences.find((s) => s.claimIds.some((id) => id.startsWith('n1#')));
  assert.equal(dispute.decision, 'reuse', '争议句不得因容量被删去一方');
  assert.match(dispute.text, /不能从埋放位置确定/);
  assert.ok(label.issues.some((i) => i.kind === 'over-limit'), '装不下要上报，不得偷删限定');
});
