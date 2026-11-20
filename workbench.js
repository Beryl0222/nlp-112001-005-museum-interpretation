#!/usr/bin/env node
// 策展工作台命令行：分析、撰写、换展、联审、发布与回看。
// 用法：node workbench.js <命令> [参数]，--json 输出机器可读结果。

import { readFile, writeFile } from 'node:fs/promises';
import { createWorkbench } from './src/workbench.js';

const STATE_FILE = new URL('./.workbench-state.json', import.meta.url);

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const DECISION_LABEL = { reuse: '可沿用', 'sourced-comparison': '带出处的比较', defer: '暂缓' };

function formatLabel(label) {
  const lines = [];
  const unit = label.measure === 'word' ? '词' : '字';
  lines.push(`展柜 ${label.caseId}（${label.stop} · ${label.language} · 容量 ${label.limit} ${unit}，当前可发布 ${label.publishableLength} ${unit}）`);
  for (const s of label.sentences) {
    lines.push(`  ${s.id} [${s.kind}] ${DECISION_LABEL[s.decision]} — ${s.reason}`);
    lines.push(`    ${s.text}`);
  }
  if (label.issues.length > 0) {
    lines.push('  问题：');
    for (const issue of label.issues) lines.push(`    - ${issue.note}`);
  }
  return lines.join('\n');
}

function formatEdges(edges) {
  if (edges.length === 0) return '（没有联审关系）';
  return edges.map((e) => {
    const reasons = e.reasons.map((r) => `    - [${r.kind}] ${r.note}`).join('\n');
    return `联审 ${e.from} → ${e.to}\n${reasons}`;
  }).join('\n');
}

function formatConflicts(conflicts) {
  if (conflicts.length === 0) return '（没有未决冲突）';
  return conflicts.map((c) => `${c.id} [${c.kind}] ${c.detail}\n  涉及主张：${[...c.claimIds, ...c.relatedClaimIds].join('、')}（${c.status}）`).join('\n');
}

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const [command, ...rest] = args;
  const state = await loadState();
  const wb = await createWorkbench({ state });
  const out = (text, data) => {
    if (json) process.stdout.write(`${JSON.stringify(data ?? text, null, 2)}\n`);
    else process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);
  };

  switch (command) {
    case 'overview': {
      const o = wb.overview();
      const text = [
        `实物 ${o.entities.length} 件：${o.entities.map((e) => `${e.id}（${e.aliases.join('／')}，${e.period.raw}）`).join('；')}`,
        `主张 ${o.claimCount} 条（卡 ${o.claimsByKind.card ?? 0}／手记 ${o.claimsByKind.note ?? 0}／译稿 ${o.claimsByKind.translation ?? 0}）`,
        `术语表：${o.concepts.join('、')}`,
        '未决冲突：',
        formatConflicts(o.conflicts),
        ...(o.unresolved.length ? ['待确认归属：', ...o.unresolved.map((u) => `  ${u.id}（${u.sourceId}）：${u.subject}`)] : []),
      ].join('\n');
      out(text, o);
      break;
    }
    case 'case': {
      const label = wb.composeCase(rest[0]);
      out(formatLabel(label), label);
      break;
    }
    case 'route': {
      const composed = wb.composeRoute({});
      const lines = composed.stopsOut.map((s) => {
        const defines = s.label.defines.length ? `给出术语：${s.label.defines.join('、')}` : '未给出术语';
        const uses = s.label.uses.length ? `使用术语：${s.label.uses.join('、')}` : '未使用术语';
        return `展位 ${s.stop.baseStop}（计划 ${s.plan.id}，实物 ${s.plan.itemIds.join('、')}）\n  ${defines}；${uses}`;
      });
      lines.push('', formatEdges(composed.edges));
      out(lines.join('\n'), composed);
      break;
    }
    case 'joint-review': {
      const edges = wb.jointReview();
      out(formatEdges(edges), edges);
      break;
    }
    case 'swap': {
      const { report, edgesAfter } = wb.swap(rest[0]);
      const lines = ['换展影响：'];
      for (const c of report.changedStops) {
        lines.push(`  展位 ${c.stop}：${c.from} → ${c.to}（换出 ${c.itemsOut.join('、') || '无'}；换入 ${c.itemsIn.join('、') || '无'}）`);
      }
      if (report.conceptsLost.length) lines.push(`  不再提供的术语：${report.conceptsLost.join('、')}`);
      if (report.conceptsGained.length) lines.push(`  新提供的术语：${report.conceptsGained.join('、')}`);
      for (const down of report.downstream) {
        lines.push(`  下游 ${down.caseId}：`);
        for (const s of down.removedSentences ?? []) lines.push(`    撤下 [${s.kind}] ${s.text}`);
        for (const s of down.addedSentences) lines.push(`    新增 [${s.kind}] ${s.text}`);
      }
      if (report.actions.length) {
        lines.push('  后续展签需要的动作：');
        for (const a of report.actions) lines.push(`    - [${a.action}] ${a.caseId ? `${a.caseId}：` : ''}${a.reason}`);
      }
      lines.push('', '换展后的联审关系：', formatEdges(edgesAfter));
      out(lines.join('\n'), { report, edgesAfter });
      break;
    }
    case 'translate-review': {
      const conflicts = wb.getConflicts();
      const claims = wb.getClaims();
      const lines = conflicts.map((c) => {
        const tr = claims.find((x) => x.id === c.claimIds[0]);
        const src = claims.find((x) => x.id === c.relatedClaimIds[0]);
        return [
          `${c.id}：${c.detail}`,
          `  来源 ${src.sourceId}（${src.language}，${src.modality}）：${src.text}`,
          `  译文 ${tr.sourceId}（${tr.language}，${tr.modality}）：${tr.text}`,
          '  处置：译句暂缓，原手记句可沿用；比较句须带出处',
        ].join('\n');
      });
      out(lines.length ? lines.join('\n') : '（没有译文语气偏移）', conflicts);
      break;
    }
    case 'publish': {
      const byIndex = rest.indexOf('--by');
      const noteIndex = rest.indexOf('--note');
      const caseId = rest[0];
      const by = byIndex >= 0 ? rest[byIndex + 1] : '未署名编辑';
      const note = noteIndex >= 0 ? rest[noteIndex + 1] : '';
      const version = wb.publish(caseId, { by, note });
      await saveState(wb.state());
      out(`已发布 ${caseId} 第 ${version.n} 版（暂缓 ${version.withheld.length} 句留在编辑端）\n${version.text}`, version);
      break;
    }
    case 'visitor': {
      const view = wb.visitorView(rest[0]);
      if (!view) {
        out(`展柜 ${rest[0]} 尚未发布`);
        break;
      }
      const sources = view.sources.map((s) => `${s.record}${s.field ? `（${s.field} ${s.start ?? 0}–${s.end ?? 0}）` : ''}`).join('、');
      out(`展柜 ${view.caseId}（${view.stop}）第 ${view.version} 版\n${view.text}\n公开出处：${sources || '无'}`, view);
      break;
    }
    case 'history': {
      const history = wb.history(rest[0]);
      if (history.length === 0) {
        out(`展柜 ${rest[0]} 没有历史版本`);
        break;
      }
      const lines = history.map((v) => {
        const withheld = v.withheld.map((w) => `    暂缓 ${w.sentenceId}：${w.reason}`).join('\n');
        return `第 ${v.n} 版（${v.at}，${v.by}${v.note ? `，${v.note}` : ''}）\n  ${v.text}\n  当时未决冲突：${v.openConflicts.join('、') || '无'}${withheld ? `\n${withheld}` : ''}`;
      });
      out(lines.join('\n\n'), history);
      break;
    }
    case 'confirm-alias': {
      wb.confirmAlias(rest[0], rest[1]);
      await saveState(wb.state());
      out(`已确认别名「${rest[0]}」→ ${rest[1]}，相关主张与比较已重判`);
      break;
    }
    case 'merge': {
      const ids = rest[0].split(',');
      wb.mergeEntities(ids, rest[1]);
      await saveState(wb.state());
      out(`已把 ${ids.join('、')} 误合为 ${rest[1]}（用于演示拆分）`);
      break;
    }
    case 'split': {
      wb.splitEntity(rest[0]);
      await saveState(wb.state());
      const claims = wb.getClaims();
      const lines = claims.map((c) => `  ${c.id} → ${c.subject.kind === 'object' ? c.subject.entityId : `${c.subject.kind}（${c.subject.text ?? ''}）`}：${c.text}`);
      out(`已拆分 ${rest[0]}，主张按各自来源重新归属（证据不复制）：\n${lines.join('\n')}`);
      break;
    }
    default:
      out([
        '用法：node workbench.js <命令>',
        '  overview            实物、主张、冲突总览',
        '  case <展柜>         撰写该展柜的展签草稿（逐句判定）',
        '  route               动线上的术语流动',
        '  joint-review        相邻展签的联审关系及来源术语/主张',
        '  swap <替补计划>     换展影响分析',
        '  translate-review    译文审校（推测→断言）',
        '  publish <展柜> --by <编辑> [--note 说明]',
        '  visitor <展柜>      观众视图：当前生效文字与可公开出处',
        '  history <展柜>      研究员视图：历史版本与当时判断',
        '  confirm-alias <别名> <实物>',
        '  merge <id,id> <合并id> / split <合并id>',
      ].join('\n'));
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
