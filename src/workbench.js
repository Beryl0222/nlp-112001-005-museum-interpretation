// 工作台门面：加载资料，组装实体、主张、术语表与动线，提供策展操作。

import { readMaterials } from '../materials.js';
import { EntityRegistry } from './entities.js';
import { buildComparison, extractClaims, reviewTranslations } from './claims.js';
import { buildGlossary, composeLabel } from './labels.js';
import { buildRoute, diffRoutes, jointReviewEdges } from './route.js';
import { PublicationStore } from './publication.js';

export async function createWorkbench({ directory, state } = {}) {
  const tables = await readMaterials(directory);
  const registry = new EntityRegistry(tables['藏品.json']);
  const publications = new PublicationStore(state?.publications);
  const actions = [...(state?.actions ?? [])];
  const route = buildRoute(tables['展柜计划.json']);

  let claims = [];
  let conflicts = [];
  let glossary = {};

  function rebuild() {
    claims = extractClaims(tables, registry);
    ({ conflicts } = reviewTranslations(claims));
    glossary = buildGlossary(claims);
  }

  function applyAction(action) {
    if (action.type === 'confirm-alias') {
      registry.confirmAlias(action.alias, action.entityId);
    } else if (action.type === 'merge') {
      registry.mergeEntities(action.ids, action.mergedId);
    } else if (action.type === 'split') {
      registry.splitEntity(action.mergedId, action.parts);
    } else {
      throw new Error(`未知编辑动作：${action.type}`);
    }
  }

  for (const action of actions) applyAction(action);
  rebuild();

  function recordAction(action) {
    applyAction(action);
    actions.push(action);
    rebuild();
  }

  // 按动线顺序撰写各展位展签；overrides 以展位名指定启用的计划（主或替补）。
  // 上游上下文按"实际可发布内容"累积：术语供给按语言区分，参见委托只覆盖已发布句。
  function composeRoute(overrides = {}) {
    const activePlans = route.stops.map((stop) => {
      const planId = overrides[stop.baseStop];
      const plan = planId ? route.plans.get(planId) : stop.main;
      if (!plan) throw new Error(`展位 ${stop.baseStop} 没有计划 ${planId}`);
      return plan;
    });
    const stopsOut = [];
    const upstreamItems = new Set();
    const upstreamConcepts = new Set();
    const upstreamCards = new Set();
    const upstreamClaims = new Map();
    for (let i = 0; i < route.stops.length; i += 1) {
      const plan = activePlans[i];
      const laterItems = new Set(activePlans.slice(i + 1).flatMap((p) => p.itemIds));
      const label = composeLabel(plan, {
        claims,
        conflicts,
        registry,
        glossary,
        route: {
          upstreamItems: new Set(upstreamItems),
          upstreamConcepts: new Set(upstreamConcepts),
          upstreamCards: new Set(upstreamCards),
          upstreamClaims: new Map([...upstreamClaims].map(([k, v]) => [k, new Set(v)])),
          laterItems,
        },
      });
      stopsOut.push({ stop: route.stops[i], plan, label });
      const publishable = label.sentences.filter((s) => s.decision === 'reuse' || s.decision === 'sourced-comparison');
      for (const id of plan.itemIds) upstreamItems.add(id);
      for (const c of label.defines) upstreamConcepts.add(`${label.language}:${c}`);
      for (const s of publishable) {
        if (s.kind !== 'card') continue;
        const claim = s.claimIds.map((cid) => claims.find((c) => c.id === cid)).find(Boolean);
        if (claim?.subject.kind === 'object') upstreamCards.add(claim.subject.entityId);
      }
      for (const s of publishable) {
        for (const cid of s.claimIds) {
          const claim = claims.find((c) => c.id === cid);
          const owner = claim?.subject.kind === 'object' ? claim.subject.entityId
            : claim?.subject.kind === 'type' ? claim.subject.of
            : null;
          if (owner) {
            const set = upstreamClaims.get(owner) ?? new Set();
            set.add(cid);
            upstreamClaims.set(owner, set);
          }
        }
      }
    }
    return { stopsOut, edges: jointReviewEdges(stopsOut) };
  }

  // 撰写单个展柜：替补计划按启用它来写，主计划按当前动线写。
  function composeCase(caseId) {
    const plan = route.plans.get(caseId);
    if (!plan) throw new Error(`没有展柜计划 ${caseId}`);
    const overrides = plan.isSubstitute ? { [plan.baseStop]: plan.id } : {};
    const composed = composeRoute(overrides);
    const found = composed.stopsOut.find((s) => s.plan.id === caseId);
    return found.label;
  }

  const workbench = {
    tables,
    registry,
    route,
    publications,
    getClaims: () => claims,
    getConflicts: () => conflicts,
    getGlossary: () => glossary,
    getActions: () => [...actions],

    overview() {
      return {
        entities: registry.list(),
        claimCount: claims.length,
        claimsByKind: claims.reduce((acc, c) => ({ ...acc, [c.sourceKind]: (acc[c.sourceKind] ?? 0) + 1 }), {}),
        conflicts,
        concepts: Object.keys(glossary),
        unresolved: claims
          .filter((c) => c.subject.kind === 'unresolved')
          .map((c) => ({ id: c.id, sourceId: c.sourceId, subject: c.subject.text })),
      };
    },

    composeCase,
    composeRoute,

    jointReview() {
      return composeRoute({}).edges;
    },

    // 换展分析：启用替补计划后，动线上的术语缺口与后续展签动作。
    swap(substitutePlanId) {
      const plan = route.plans.get(substitutePlanId);
      if (!plan) throw new Error(`没有展柜计划 ${substitutePlanId}`);
      if (!plan.isSubstitute) throw new Error(`${substitutePlanId} 不是替补计划`);
      const baseline = composeRoute({});
      const swapped = composeRoute({ [plan.baseStop]: plan.id });
      return {
        baseline,
        swapped,
        report: diffRoutes(baseline, swapped),
        edgesAfter: jointReviewEdges(swapped.stopsOut),
      };
    },

    comparison(topic, entityIds) {
      return buildComparison(claims, topic, entityIds);
    },

    confirmAlias(alias, entityId) {
      recordAction({ type: 'confirm-alias', alias, entityId });
    },

    mergeEntities(ids, mergedId) {
      recordAction({ type: 'merge', ids, mergedId });
    },

    // 拆开误合：拆分规格取自馆藏卡原记录，证据按各自主张的来源重新归属。
    splitEntity(mergedId) {
      const merged = registry.get(mergedId);
      if (!merged?.mergedFrom) throw new Error(`${mergedId} 不是合并记录`);
      const parts = merged.mergedFrom.map((id) => {
        const row = tables['藏品.json'].find((r) => r.id === id);
        if (!row) throw new Error(`馆藏卡中没有 ${id} 的原记录`);
        return { id: row.id, alias: row.alias, museum: row.museum, period: row.period, label: row.label };
      });
      recordAction({ type: 'split', mergedId, parts });
    },

    publish(caseId, { by, note } = {}) {
      const label = composeCase(caseId);
      const claimsById = new Map(claims.map((c) => [c.id, c]));
      return publications.publish(label, { by, note, claimsById, conflicts });
    },

    visitorView(caseId) {
      return publications.visitorView(caseId, route.plans.get(caseId));
    },

    history(caseId) {
      return publications.history(caseId);
    },

    state() {
      return { actions, publications: publications.toJSON() };
    },
  };
  return workbench;
}
