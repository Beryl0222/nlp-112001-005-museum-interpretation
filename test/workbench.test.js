import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { createWorkbench } from '../src/workbench.js';

const execFileAsync = promisify(execFile);
const cliUrl = new URL('../workbench.js', import.meta.url);

test('误合再拆分：跨语言引文归属与比较主张随之重判，证据不复制', async () => {
  const wb = await createWorkbench();
  wb.mergeEntities(['q-31', 'q-38'], 'q-he');
  let claims = wb.getClaims();
  // 误合期间：两物的证据都挂在合并记录上
  const merged = claims.filter((c) => c.subject.kind === 'object' && c.subject.entityId === 'q-he');
  assert.ok(merged.some((c) => c.sourceId === 'n1'));
  assert.ok(merged.some((c) => c.sourceId === 'n2'));
  wb.splitEntity('q-he');
  claims = wb.getClaims();
  const of = (entityId) => claims.filter((c) => c.subject.kind === 'object' && c.subject.entityId === entityId);
  // 跨语言引文归属重判：n1 与译稿 n4 归 q-31，n2 归 q-38
  assert.ok(of('q-31').some((c) => c.sourceId === 'n1'));
  assert.ok(of('q-31').some((c) => c.sourceId === 'n4'));
  assert.ok(of('q-38').some((c) => c.sourceId === 'n2'));
  // 证据不复制：q-31 没有炊煮证据，q-38 没有献礼推测
  assert.ok(!of('q-31').some((c) => c.sourceId === 'n2'));
  assert.ok(!of('q-38').some((c) => c.sourceId === 'n1'));
  // 比较主张重判：q-31 一侧只有推测，q-38 一侧有证据，只能带出处
  const comparison = wb.comparison('用途', ['q-31', 'q-38']);
  assert.equal(comparison.verdict, 'sourced-only');
  // 冲突跟着译稿走，仍指向 q-31 一侧
  const conflicts = wb.getConflicts();
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].claimIds[0].startsWith('n4#'));
});

test('别名确认：确认前主张无归属，确认后归到实物', async (context) => {
  const scratch = await mkdtemp(join(tmpdir(), 'workbench-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = join(scratch, '资料');
  await cp(new URL('../资料/', import.meta.url), directory, { recursive: true });
  const notes = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(directory, '手记.json'), 'utf8')));
  notes.push({ id: 'n5', author: '复核员', language: 'en', subject: 'rimmed bowl', text: 'The rimmed bowl may have been a lamp.' });
  await writeFile(join(directory, '手记.json'), JSON.stringify(notes, null, 2));

  const wb = await createWorkbench({ directory: pathToFileURL(directory + sep) });
  let overview = wb.overview();
  assert.ok(overview.unresolved.some((u) => u.subject === 'rimmed bowl'));
  wb.confirmAlias('rimmed bowl', 'q-31');
  overview = wb.overview();
  assert.ok(!overview.unresolved.some((u) => u.subject === 'rimmed bowl'));
  const claims = wb.getClaims();
  assert.ok(claims.some((c) => c.sourceId === 'n5' && c.subject.kind === 'object' && c.subject.entityId === 'q-31'));
});

test('CLI：overview 与 case 命令可用', async () => {
  const overview = await execFileAsync('node', [cliUrl.pathname, 'overview']);
  assert.match(overview.stdout, /实物 3 件/);
  assert.match(overview.stdout, /modality-shift/);
  const composed = await execFileAsync('node', [cliUrl.pathname, 'case', 'c1']);
  assert.match(composed.stdout, /暂缓/);
  assert.match(composed.stdout, /可沿用/);
});
