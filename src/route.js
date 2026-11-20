// 动线分析：展柜顺序、术语在动线上的流动、相邻展签的联审关系、换展影响。

// 解析展柜计划：stop 含"替补"的计划挂到同名展位的替补位。
export function buildRoute(planRows) {
  const stops = [];
  const plans = new Map();
  for (const row of planRows) {
    const isSubstitute = /替补/.test(row.stop);
    const baseStop = row.stop.replace(/替补/g, '').trim();
    const plan = {
      id: row.id,
      stop: row.stop,
      baseStop,
      language: row.language,
      items: row.items,
      itemIds: row.items.split('、').map((s) => s.trim()).filter(Boolean),
      limitNumber: Number.parseInt(row.limit, 10),
      isSubstitute,
    };
    plans.set(plan.id, plan);
    if (isSubstitute) {
      const stop = stops.find((s) => s.baseStop === baseStop);
      if (!stop) throw new Error(`替补计划 ${plan.id} 找不到对应展位 ${baseStop}`);
      stop.substitutes.push(plan);
    } else {
      stops.push({ baseStop, main: plan, substitutes: [] });
    }
  }
  return { stops, plans };
}

// 相邻展签的联审关系：共享实物、跨语言呈现的同一主张、术语的给出与使用。
export function jointReviewEdges(stopsOut) {
  const edges = [];
  const definedBefore = new Set();
  const claimsBefore = new Map(); // sourceId → caseId
  const itemsBefore = new Map(); // itemId → caseId
  for (let i = 0; i < stopsOut.length; i += 1) {
    const current = stopsOut[i];
    const reasons = [];
    for (const itemId of current.plan.itemIds) {
      if (itemsBefore.has(itemId)) {
        reasons.push({ kind: 'item', key: itemId, note: `实物 ${itemId} 在 ${itemsBefore.get(itemId)} 与本柜同线展出` });
      }
    }
    const currentSources = new Set(current.label.sentences.flatMap((s) => s.sources.map((src) => src.record)));
    for (const [sourceId, caseId] of claimsBefore) {
      if (currentSources.has(sourceId)) {
        reasons.push({ kind: 'claim', key: sourceId, note: `主张来源 ${sourceId} 在 ${caseId} 与本柜跨展柜（可能跨语言）呈现` });
      }
    }
    for (const concept of current.label.uses) {
      if (definedBefore.has(concept)) {
        reasons.push({ kind: 'concept', key: concept, note: `术语「${concept}」由前站给出，本柜使用` });
      }
    }
    if (reasons.length > 0 && i > 0) {
      edges.push({ from: stopsOut[i - 1].plan.id, to: current.plan.id, reasons });
    }
    for (const c of current.label.defines) definedBefore.add(c);
    for (const s of current.label.sentences) {
      for (const src of s.sources) claimsBefore.set(src.record, current.plan.id);
    }
    for (const itemId of current.plan.itemIds) itemsBefore.set(itemId, current.plan.id);
  }
  return edges;
}

// 换展影响：对比基线与换展后的动线，列出术语缺口与后续展签需要的动作。
export function diffRoutes(baseline, swapped) {
  const report = { changedStops: [], downstream: [], conceptsLost: [], conceptsGained: [], actions: [] };
  const definesOf = (routeOut) => {
    const all = new Set();
    for (const s of routeOut.stopsOut) for (const c of s.label.defines) all.add(c);
    return all;
  };
  const baseDefines = definesOf(baseline);
  const swapDefines = definesOf(swapped);
  report.conceptsLost = [...baseDefines].filter((c) => !swapDefines.has(c));
  report.conceptsGained = [...swapDefines].filter((c) => !baseDefines.has(c));

  for (let i = 0; i < swapped.stopsOut.length; i += 1) {
    const before = baseline.stopsOut[i];
    const after = swapped.stopsOut[i];
    if (before.plan.id !== after.plan.id) {
      report.changedStops.push({
        stop: after.stop.baseStop,
        from: before.plan.id,
        to: after.plan.id,
        itemsOut: before.plan.itemIds.filter((x) => !after.plan.itemIds.includes(x)),
        itemsIn: after.plan.itemIds.filter((x) => !before.plan.itemIds.includes(x)),
      });
      continue;
    }
    // 同一计划但上下文变了：比较句子与判定。
    const beforeTexts = new Map(before.label.sentences.map((s) => [s.kind + s.text, s]));
    const afterTexts = new Map(after.label.sentences.map((s) => [s.kind + s.text, s]));
    const added = after.label.sentences.filter((s) => !beforeTexts.has(s.kind + s.text));
    const removed = before.label.sentences.filter((s) => !afterTexts.has(s.kind + s.text));
    const newIssues = after.label.issues.filter(
      (issue) => !before.label.issues.some((b) => b.kind === issue.kind && b.note === issue.note),
    );
    if (added.length > 0 || removed.length > 0 || newIssues.length > 0) {
      report.downstream.push({
        caseId: after.plan.id,
        addedSentences: added.map((s) => ({ id: s.id, kind: s.kind, text: s.text })),
        removedSentences: removed.map((s) => ({ id: s.id, kind: s.kind, text: s.text })),
        newIssues,
      });
    }
  }

  // 汇总后续展签需要的动作。
  for (const down of report.downstream) {
    for (const s of down.addedSentences) {
      if (s.kind === 'card' || s.kind === 'claim') {
        report.actions.push({ caseId: down.caseId, action: '补释义', reason: `前站不再提供相关介绍，需补：${s.text}` });
      }
    }
    for (const issue of down.newIssues) {
      if (issue.kind === 'deferred-for-capacity' || issue.kind === 'comparison-deferred') {
        report.actions.push({ caseId: down.caseId, action: '调整比较对象', reason: issue.note });
      } else if (issue.kind === 'concept-needs-gloss') {
        report.actions.push({ caseId: down.caseId, action: '补释义', reason: issue.note });
      } else if (issue.kind === 'over-limit') {
        report.actions.push({ caseId: down.caseId, action: '暂缓', reason: issue.note });
      }
    }
  }
  for (const concept of report.conceptsLost) {
    report.actions.push({ caseId: null, action: '补释义', reason: `术语「${concept}」不再由动线提供，使用它的展签需补释义或调整比较对象` });
  }
  return report;
}
