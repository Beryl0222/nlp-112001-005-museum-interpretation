import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { EntityRegistry } from '../src/entities.js';
import { MODALITY_RANK, buildComparison, extractClaims, reviewTranslations } from '../src/claims.js';

async function setup() {
  const tables = await readMaterials();
  const registry = new EntityRegistry(tables['藏品.json']);
  const claims = extractClaims(tables, registry);
  const { conflicts } = reviewTranslations(claims);
  return { tables, registry, claims, conflicts };
}

test('主张从卡、手记、译稿提取，语气与限定保留', async () => {
  const { claims } = await setup();
  assert.equal(claims.length, 12);
  const card = claims.find((c) => c.sourceId === 'q-31');
  assert.equal(card.modality, 'fact');
  assert.ok(card.qualifiers.includes('疑似'));
  const speculation = claims.find((c) => c.sourceId === 'n1' && c.slots.purpose === '献礼');
  assert.equal(speculation.modality, 'speculation');
  const supported = claims.find((c) => c.sourceId === 'n2' && c.topic === '用途');
  assert.equal(supported.modality, 'supported');
  const translation = claims.find((c) => c.sourceId === 'n4');
  assert.equal(translation.sourceKind, 'translation');
  assert.equal(translation.modality, 'assertion');
});

test('类型级指称不贴到具体实物，地名不当作年代或实物', async () => {
  const { claims } = await setup();
  const untested = claims.find((c) => c.sourceId === 'n2' && c.topic === '数据缺口');
  assert.equal(untested.subject.kind, 'type');
  assert.equal(untested.subject.of, 'q-38');
  const pit = claims.find((c) => c.sourceId === 'a-11' && c.topic === '用途');
  assert.equal(pit.modality, 'unknown');
  assert.equal(pit.slots.about, '坑体');
});

test('原文位置以记录编号与文本范围定位', async () => {
  const { tables, claims } = await setup();
  const note = claims.find((c) => c.sourceId === 'n1' && c.slots.purpose === '献礼');
  const row = tables['手记.json'].find((r) => r.id === 'n1');
  assert.equal(row.text.slice(note.locator.start, note.locator.end), note.text);
});

test('译审发现推测被写成断言，只追究译句', async () => {
  const { conflicts } = await setup();
  assert.equal(conflicts.length, 1);
  const [conflict] = conflicts;
  assert.equal(conflict.kind, 'modality-shift');
  const translation = conflict.claimIds[0];
  const source = conflict.relatedClaimIds[0];
  assert.ok(translation.startsWith('n4#'));
  assert.ok(source.startsWith('n1#'));
  assert.equal(conflict.status, 'open');
});

test('比较主张：两边都要有独立依据，推测级只能带出处', async () => {
  const { claims } = await setup();
  const cross = buildComparison(claims, '用途', ['q-31', 'a-11']);
  assert.equal(cross.verdict, 'sourced-only');
  assert.notEqual(cross.sides[0].sourceId, cross.sides[1].sourceId);
  const mixed = buildComparison(claims, '用途', ['q-38', 'a-11']);
  assert.equal(mixed.verdict, 'sourced-only');
  const missing = buildComparison(claims, '特征', ['q-31', 'a-11']);
  assert.equal(missing.verdict, 'defer');
});

test('比较主张：同源依据不算独立', async () => {
  const { claims } = await setup();
  const [one] = claims.filter((c) => c.sourceId === 'n1' && c.topic === '用途');
  const synthetic = [
    { ...one, id: 'x1', subject: { kind: 'object', entityId: 'e1' } },
    { ...one, id: 'x2', subject: { kind: 'object', entityId: 'e2' } },
  ];
  const verdict = buildComparison(synthetic, '用途', ['e1', 'e2']);
  assert.equal(verdict.verdict, 'defer');
  assert.match(verdict.reason, /不独立/);
});

test('语气等级：不详 < 推测 < 有证据 < 断言', () => {
  assert.ok(MODALITY_RANK.unknown < MODALITY_RANK.speculation);
  assert.ok(MODALITY_RANK.speculation < MODALITY_RANK.supported);
  assert.ok(MODALITY_RANK.supported < MODALITY_RANK.assertion);
});
