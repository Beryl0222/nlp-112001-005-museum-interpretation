// 主张层：从馆藏卡、研究手记、译稿中提取主张，保留语气与原文位置，
// 审校译文语气偏移，构造需要双边独立依据的比较主张。

import { classifyFreeName } from './entities.js';

export const MODALITY_RANK = { unknown: 0, speculation: 1, supported: 2, assertion: 3, fact: 3 };

const MODALITY_MARKERS = {
  zh: {
    assertion: ['确实', '肯定', '必定'],
    supported: ['支持'],
    speculation: ['也许', '可能', '疑似', '或许'],
    unknown: ['不详', '不能', '无法', '没有测', '未测'],
  },
  en: {
    assertion: ['definitely', 'certainly'],
    supported: ['evidence supports'],
    speculation: ['may', 'might', 'perhaps', 'suggested'],
    unknown: ['unknown', 'unclear', 'no direct evidence', 'without direct evidence', 'not tested'],
  },
};

// 受保护的限定语：简版不得删去这些语气与范围限定。
const GUARDED_TOKENS = [
  '约', '疑似', '也许', '可能', '不详', '不能', '无法', '没有测', '未测', '另一个', '同类',
  'may', 'might', 'perhaps', 'suggested', 'without direct evidence', 'no direct evidence',
  'unknown', 'unclear', 'not tested', 'c.',
];

// 概念词表：跨语言渲染用受控词汇；释义（gloss）必须另有出处，见术语表。
export const CONCEPTS = {
  献礼: { zh: '献礼', en: 'offerings' },
  仪式: { zh: '仪式用途', en: 'ritual use' },
  炊煮: { zh: '日常炊煮', en: 'daily cooking' },
  谷物: { zh: '盛放谷物', en: 'holding grain' },
  回纹: { zh: '回纹', en: 'huiven (rim pattern)' },
};

const CONCEPT_BY_TEXT = [
  [/献礼|offering/i, '献礼'],
  [/仪式|ritual/i, '仪式'],
  [/炊煮|cooking/i, '炊煮'],
  [/谷物|grain/i, '谷物'],
  [/回纹|rim pattern|huiven/i, '回纹'],
];

export function conceptsIn(text) {
  return CONCEPT_BY_TEXT.filter(([re]) => re.test(text)).map(([, key]) => key);
}

// 分句：中文按 。，、；断开（限定语常在小句里），英文按句末点断开。
// text 与 locator 都不含结尾标点，范围精确对应正文。
export function splitClauses(text, language) {
  const re = language === 'zh' ? /[^。，、；]+[。，、；]?/g : /[^.!?]+[.!?]?/g;
  const clauses = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index + raw.indexOf(trimmed);
    const stripped = trimmed.replace(/[。，、；.!?]+$/, '');
    clauses.push({ text: stripped, start, end: start + stripped.length });
  }
  return clauses;
}

export function detectModality(text, language, fallback = 'assertion') {
  const markers = MODALITY_MARKERS[language] ?? MODALITY_MARKERS.zh;
  const lower = text.toLowerCase();
  for (const modality of ['assertion', 'supported', 'speculation', 'unknown']) {
    if (markers[modality].some((w) => lower.includes(w.toLowerCase()))) return modality;
  }
  return fallback;
}

export function guardedTokensIn(text) {
  const lower = text.toLowerCase();
  return GUARDED_TOKENS.filter((t) => lower.includes(t.toLowerCase()));
}

function detectTopic(text) {
  if (/用途|用于|献礼|炊煮|盛放|held|used|use|offering|grain|ritual|cooking/i.test(text)) return '用途';
  if (/出土|发现|excavat|found|near/i.test(text)) return '出土语境';
  if (/纹|口沿|rim|pattern/i.test(text)) return '特征';
  return '其他';
}

// 结构化槽位提取：只识别受控句式，识别不了的保留原文引用。
const SLOT_RULES = [
  { pattern: 'excavated-at', re: /^出土于(?<place>.+?)$/, topic: '出土语境', modality: 'fact', slots: (g) => ({ relation: 'excavated-at', place: g.place }) },
  { pattern: 'found-near', re: /^(?<place>.+?)附近发现$/, topic: '出土语境', modality: 'fact', slots: (g) => ({ relation: 'found-near', place: g.place }) },
  { pattern: 'found-near', re: /^found near (?<place>.+?)$/i, topic: '出土语境', modality: 'fact', slots: (g) => ({ relation: 'found-near', place: g.place }) },
  { pattern: 'purpose-unknown-about', re: /^(?<what>.+?)用途不详$/, topic: '用途', modality: 'unknown', slots: (g) => ({ about: g.what }) },
  { pattern: 'feature', re: /^口沿有(?<feature>.+?)$/, topic: '特征', modality: 'fact', slots: (g) => ({ feature: g.feature }) },
  { pattern: 'purpose-speculation', re: /也许用于(?<purpose>.+?)$/, topic: '用途', modality: 'speculation', slots: (g) => ({ purpose: conceptsIn(g.purpose)[0] ?? g.purpose }) },
  { pattern: 'purpose-undeterminable', re: /不能从(?<scope>.+?)确定$/, topic: '用途', modality: 'unknown', slots: (g) => ({ scope: g.scope }) },
  { pattern: 'purpose-supported', re: /^(?<evidence>.+?)支持(?<purpose>.+?)$/, topic: '用途', modality: 'supported', slots: (g) => ({ evidence: g.evidence, purpose: conceptsIn(g.purpose)[0] ?? g.purpose }) },
  { pattern: 'type-untested', re: /^(?<what>另一个.+?|.+?同类.+?)没有测$/, topic: '数据缺口', modality: 'unknown', slots: (g) => ({ about: g.what }) },
  { pattern: 'held-speculation', re: /may have held (?<what>\w+)/i, topic: '用途', modality: 'speculation', slots: () => ({ purpose: '谷物' }) },
  { pattern: 'ritual-suggested', re: /ritual use has been suggested/i, topic: '用途', modality: 'speculation', slots: () => ({ purpose: '仪式' }) },
  { pattern: 'definitely-used', re: /definitely used for (?<what>\w+)/i, topic: '用途', modality: 'assertion', slots: (g) => ({ purpose: conceptsIn(g.what)[0] ?? g.what }) },
];

function applySlotRules(clauseText, topic, modality) {
  for (const rule of SLOT_RULES) {
    const m = clauseText.match(rule.re);
    if (m) {
      return {
        pattern: rule.pattern,
        topic: rule.topic ?? topic,
        modality: rule.modality ?? modality,
        slots: rule.slots(m.groups ?? {}),
      };
    }
  }
  return { pattern: null, topic, modality, slots: {} };
}

export function extractClaims(tables, registry) {
  const claims = [];
  const seqBySource = new Map();
  const nextClaimId = (sourceId) => {
    const n = (seqBySource.get(sourceId) ?? 0) + 1;
    seqBySource.set(sourceId, n);
    return `${sourceId}#${n}`;
  };
  // 馆藏卡：结构化事实，语气为 fact，但保留"疑似"等限定语。
  for (const row of tables['藏品.json']) {
    const entity = registry.get(row.id);
    if (!entity) continue;
    for (const clause of splitClauses(row.label, 'zh')) {
      const ruled = applySlotRules(clause.text, detectTopic(clause.text), 'fact');
      claims.push({
        id: nextClaimId(row.id),
        sourceId: row.id,
        sourceKind: 'card',
        author: row.museum,
        language: 'zh',
        subject: { kind: 'object', entityId: row.id, via: row.alias, confirmed: true },
        topic: ruled.topic,
        modality: ruled.modality,
        pattern: ruled.pattern,
        slots: ruled.slots,
        text: clause.text,
        locator: { record: row.id, field: 'label', start: clause.start, end: clause.end },
        qualifiers: guardedTokensIn(clause.text),
        status: 'active',
        translationOf: null,
      });
    }
  }
  // 手记与译稿：按作者与语言区分；译稿一律先审后发。
  for (const row of tables['手记.json']) {
    const isTranslation = /译/.test(row.author);
    const sourceKind = isTranslation ? 'translation' : 'note';
    const subject = registry.resolveName(row.subject) ?? { kind: 'unresolved', text: row.subject };
    for (const clause of splitClauses(row.text, row.language)) {
      const ruled = applySlotRules(clause.text, detectTopic(clause.text), detectModality(clause.text, row.language));
      // 类型级指称：句中谈"同类另一件"时，主语不是记录自报的实物。
      let claimSubject = subject;
      if (ruled.topic === '数据缺口' || (classifyFreeName(clause.text) === 'type' && /没有测|未测|not tested/i.test(clause.text))) {
        claimSubject = { kind: 'type', of: subject.entityId ?? null, text: clause.text };
      }
      claims.push({
        id: nextClaimId(row.id),
        sourceId: row.id,
        sourceKind,
        author: row.author,
        language: row.language,
        subject: claimSubject,
        topic: ruled.topic,
        modality: ruled.modality,
        pattern: ruled.pattern,
        slots: ruled.slots,
        text: clause.text,
        locator: { record: row.id, field: 'text', start: clause.start, end: clause.end },
        qualifiers: guardedTokensIn(clause.text),
        status: 'active',
        translationOf: null,
      });
    }
  }
  return claims;
}

// 译文审校：同一实物、同一命题（用途概念相同）下，译文语气强于来源即构成冲突。
export function reviewTranslations(claims) {
  const conflicts = [];
  const pairs = [];
  const translations = claims.filter((c) => c.sourceKind === 'translation');
  const originals = claims.filter((c) => c.sourceKind === 'note');
  const sameProposition = (a, b) => {
    const pa = a.slots?.purpose;
    const pb = b.slots?.purpose;
    if (!pa || !pb) return false;
    const ca = conceptsIn(pa)[0] ?? pa;
    const cb = conceptsIn(pb)[0] ?? pb;
    return ca === cb;
  };
  for (const tr of translations) {
    const candidates = originals.filter(
      (o) => o.subject.kind === 'object' && tr.subject.kind === 'object'
        && o.subject.entityId === tr.subject.entityId && o.topic === tr.topic
        && sameProposition(o, tr),
    );
    for (const src of candidates) {
      const shift = MODALITY_RANK[tr.modality] - MODALITY_RANK[src.modality];
      pairs.push({ translation: tr.id, source: src.id, shift });
      tr.translationOf = src.id;
      if (shift > 0) {
        conflicts.push({
          id: `conflict-${tr.id}`,
          kind: 'modality-shift',
          claimIds: [tr.id],
          relatedClaimIds: [src.id],
          detail: `译文 ${tr.sourceId} 把 ${src.sourceId} 的${src.modality === 'speculation' ? '推测' : '限定'}写成了更强的断言`,
          status: 'open',
        });
        tr.status = 'conflicted';
      }
    }
  }
  return { conflicts, pairs };
}

export function openConflictsFor(conflicts, claimId) {
  return conflicts.filter((c) => c.status === 'open' && (c.claimIds.includes(claimId) || c.relatedClaimIds.includes(claimId)));
}

// 只针对"责任方"主张的未决冲突：来源句不因译文犯错而受牵连。
export function openConflictsAgainst(conflicts, claimId) {
  return conflicts.filter((c) => c.status === 'open' && c.claimIds.includes(claimId));
}

// 概念族：比较不同文化的做法时，同族概念才构成可比较的双方。
const CONCEPT_GROUPS = [['献礼', '仪式']];

function claimConcept(claim) {
  return conceptsIn(claim.text)[0] ?? null;
}

function sameIssue(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return CONCEPT_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

// 比较主张：两边各自需要独立依据；只有推测级依据时只能以带出处形式发布。
export function buildComparison(claims, topic, entityIds) {
  const owned = entityIds.map((entityId) => claims.filter(
    (c) => c.subject.kind === 'object' && c.subject.entityId === entityId
      && c.topic === topic && c.status !== 'conflicted' && c.sourceKind !== 'card',
  ));
  const pick = (mine, others) => {
    const otherConcepts = others.flatMap((list) => list.map(claimConcept)).filter(Boolean);
    const onIssue = mine.find((c) => otherConcepts.some((oc) => sameIssue(claimConcept(c), oc)));
    if (onIssue) return onIssue;
    return mine.reduce(
      (best, c) => (best && MODALITY_RANK[best.modality] >= MODALITY_RANK[c.modality] ? best : c),
      null,
    );
  };
  const sides = entityIds.map((entityId, i) => {
    const others = owned.filter((_, j) => j !== i);
    const strongest = pick(owned[i], others);
    return { entityId, claim: strongest, sourceId: strongest?.sourceId ?? null };
  });
  const missing = sides.filter((s) => !s.claim);
  if (missing.length > 0) {
    return { topic, sides, verdict: 'defer', reason: `缺少独立依据的一方：${missing.map((s) => s.entityId).join('、')}` };
  }
  const sources = new Set(sides.map((s) => s.sourceId));
  if (sources.size < sides.length) {
    return { topic, sides, verdict: 'defer', reason: '两边依据不独立（同源）' };
  }
  const weakest = Math.min(...sides.map((s) => MODALITY_RANK[s.claim.modality]));
  if (weakest >= MODALITY_RANK.supported) {
    return { topic, sides, verdict: 'ok-assertion', reason: '两边均有证据级依据' };
  }
  return { topic, sides, verdict: 'sourced-only', reason: '至少一侧仅为推测，须带出处并保持语气' };
}
