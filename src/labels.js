// 展签撰写：按展柜的语言、容量与可展示实物生成句子级草稿。
// 每句给出判定：可沿用 / 改为带出处的比较 / 暂缓；简版不得删去限定或争议一方。

import { CONCEPTS, MODALITY_RANK, buildComparison, conceptsIn, guardedTokensIn, openConflictsAgainst } from './claims.js';

// 槽位的英文受控译法；没有受控译法的专有名词保留原文。
const SLOT_EN = {
  埋放位置: 'the burial position',
  坑体: 'the pit',
  燃烧后的留痕: 'burn marks',
  另一个同类钵: 'another bowl of the same type',
};

function slotEn(value) {
  return SLOT_EN[value] ?? CONCEPTS[value]?.en ?? value;
}

function conceptTerm(key, lang) {
  return CONCEPTS[key]?.[lang] ?? key;
}

const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd' };
function ordinalEn(n) {
  return ORDINALS[n] ?? `${n}th`;
}

export function renderPeriod(period, lang) {
  if (lang === 'zh') return period.raw;
  if (period.startCentury == null) return period.raw;
  const circa = period.circa ? 'c. ' : '';
  if (period.startCentury === period.endCentury) return `${circa}${ordinalEn(period.startCentury)} century`;
  return `${circa}${ordinalEn(period.startCentury)}–${ordinalEn(period.endCentury)} century`;
}

// 按句式模板双语渲染主张；语气词是模板的一部分，简版不得删。
export function renderClaim(claim, lang) {
  const s = claim.slots ?? {};
  const zh = {
    'excavated-at': () => `出土于${s.place}`,
    'found-near': () => `发现于${s.place}附近`,
    'purpose-unknown-about': () => `${s.about}用途不详`,
    feature: () => `口沿有${s.feature}`,
    'purpose-speculation': () => `也许用于${conceptTerm(s.purpose, 'zh')}`,
    'purpose-undeterminable': () => `不能从${s.scope}确定`,
    'purpose-supported': () => `${s.evidence}支持${conceptTerm(s.purpose, 'zh')}`,
    'type-untested': () => `${s.about}没有测`,
    'held-speculation': () => '也许盛放谷物',
    'ritual-suggested': () => '仪式用途有人提出，但无直接证据',
    'definitely-used': () => `确证用于${conceptTerm(s.purpose, 'zh')}`,
  };
  const en = {
    'excavated-at': () => `excavated at ${s.place}`,
    'found-near': () => `found near ${slotEn(s.place)}`,
    'purpose-unknown-about': () => `the purpose of ${slotEn(s.about)} is unknown`,
    feature: () => `the rim bears ${slotEn(s.feature)}`,
    'purpose-speculation': () => `may have been used for ${conceptTerm(s.purpose, 'en')}`,
    'purpose-undeterminable': () => `cannot be determined from ${slotEn(s.scope)}`,
    'purpose-supported': () => `${slotEn(s.evidence)} support ${conceptTerm(s.purpose, 'en')}`,
    'type-untested': () => `${slotEn(s.about)} was not tested`,
    'held-speculation': () => 'may have held grain',
    'ritual-suggested': () => 'a ritual use has been suggested, without direct evidence',
    'definitely-used': () => `was definitely used for ${conceptTerm(s.purpose, 'en')}`,
  };
  const table = lang === 'en' ? en : zh;
  const render = table[claim.pattern];
  // 未识别的句式只能引用原文，并标记待译。
  if (!render) return { text: claim.text, untranslated: claim.language !== lang };
  return { text: render(), untranslated: false };
}

// 术语表：释义必须来自资料原文（含位置），译文冲突未决时不作依据。
export function buildGlossary(claims) {
  const glossary = {};
  const usable = claims.filter((c) => c.status !== 'conflicted');
  for (const claim of usable) {
    for (const key of conceptsIn(claim.text)) {
      const entry = (glossary[key] ??= { key, zh: null, en: null });
      const slot = claim.language === 'en' ? 'en' : 'zh';
      if (!entry[slot]) {
        entry[slot] = {
          term: conceptTerm(key, slot),
          gloss: claim.text,
          source: { record: claim.sourceId, start: claim.locator.start, end: claim.locator.end },
        };
      }
    }
  }
  return glossary;
}

function measureText(text, measure) {
  if (measure === 'word') return text.split(/\s+/).filter(Boolean).length;
  return [...text].length;
}

const TOPIC_ORDER = ['出土语境', '特征', '用途', '数据缺口', '其他'];

let sentenceSeq = 0;
function nextSentenceId(caseId) {
  sentenceSeq += 1;
  return `${caseId}.s${sentenceSeq}`;
}

// 争议分组：同一实物同一主题、语气或命题不同的主张互为争议方，简版不得只留一方。
function disputeGroups(claims) {
  const groups = new Map();
  for (const claim of claims) {
    if (claim.subject.kind !== 'object') continue;
    const key = `${claim.subject.entityId}|${claim.topic}`;
    const group = (groups.get(key) ?? []);
    group.push(claim);
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// 简版删节候选：只删出处前缀，不动限定语与争议方；删后校验受保护语都在。
function shortenSentence(sentence) {
  const prefix = sentence.text.match(/^(据[^，]+手记，|Per [^,]+'s note, )/);
  if (!prefix) return null;
  const shortened = sentence.text.slice(prefix[0].length);
  const kept = sentence.guarded.every((token) => shortened.toLowerCase().includes(token.toLowerCase()));
  if (!kept) return null;
  return shortened;
}

export function composeLabel(plan, ctx) {
  const { claims, conflicts, registry, glossary, route } = ctx;
  const lang = plan.language;
  const measure = lang === 'en' ? 'word' : 'char';
  const items = plan.itemIds ?? plan.items.split('、').map((s) => s.trim()).filter(Boolean);
  const sentences = [];
  const issues = [];
  const upstreamCards = route.upstreamCards ?? new Set();
  const upstreamClaims = route.upstreamClaims ?? new Map();

  // 实物的主张：含直接以实物为主语的，以及以该实物为参照的类型级主张（如"另一个同类钵没有测"）。
  const entityClaims = (entityId) => claims.filter(
    (c) => (c.subject.kind === 'object' && c.subject.entityId === entityId)
      || (c.subject.kind === 'type' && c.subject.of === entityId),
  );

  for (const itemId of items) {
    const entity = registry.get(itemId);
    if (!entity) {
      issues.push({ kind: 'missing-item', itemId, note: `实物 ${itemId} 不在登记中` });
      continue;
    }
    const owned = entityClaims(itemId);
    const cardClaims = owned.filter((c) => c.sourceKind === 'card');
    const cardConcepts = [...new Set(cardClaims.flatMap((c) => conceptsIn(c.text)))];
    const covered = upstreamClaims.get(itemId) ?? new Set();

    if (upstreamCards.has(itemId)) {
      // 共展复用：前站已给出的卡载信息用参见句，依赖前站的介绍。
      sentences.push({
        id: nextSentenceId(plan.id),
        kind: 'reference',
        text: lang === 'en'
          ? `${entity.aliases[0]}: see the previous stop for this object.`
          : `${entity.aliases[0]}：实物介绍见前站。`,
        claimIds: [],
        defines: [],
        uses: cardConcepts,
        guarded: [],
        decision: 'reuse',
        reason: '前站已介绍，复用术语解释',
        sources: [],
      });
    } else {
      // 馆藏卡句：名称（保留年代原文）+ 卡载事实；特征卡（如"口沿有回纹"）本身即术语释义。
      const featureConcepts = [...new Set(cardClaims.filter((c) => c.topic === '特征').flatMap((c) => conceptsIn(c.text)))];
      const period = renderPeriod(entity.period, lang);
      const body = cardClaims.map((c) => renderClaim(c, lang).text);
      sentences.push({
        id: nextSentenceId(plan.id),
        kind: 'card',
        text: lang === 'en'
          ? `${entity.aliases[0]} (${period}): ${body.join('; ')}.`
          : `${entity.aliases[0]}（${period}）${body.join('，')}。`,
        claimIds: cardClaims.map((c) => c.id),
        defines: featureConcepts,
        uses: cardConcepts.filter((k) => !featureConcepts.includes(k)),
        guarded: cardClaims.flatMap((c) => c.qualifiers),
        decision: 'reuse',
        reason: '馆藏卡事实',
        sources: cardClaims.map((c) => c.locator),
      });
    }

    // 研究句：前站未覆盖的主张按来源合句，推测与存疑都带出处。
    const research = owned.filter((c) => c.sourceKind !== 'card' && !covered.has(c.id));
    const bySource = new Map();
    for (const c of research) {
      const list = (bySource.get(c.sourceId) ?? []);
      list.push(c);
      bySource.set(c.sourceId, list);
    }
    for (const [sourceId, group] of bySource) {
      const sorted = [...group].sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
      const ownConcepts = [...new Set(sorted.flatMap((c) => conceptsIn(c.text)))];
      const rendered = sorted.map((c) => renderClaim(c, lang));
      const needsTranslation = rendered.some((r) => r.untranslated);
      const hedged = sorted.some((c) => MODALITY_RANK[c.modality] <= MODALITY_RANK.speculation || c.modality === 'unknown');
      const prefix = hedged
        ? (lang === 'en' ? `Per the note by ${sorted[0].author}, ` : `据${sorted[0].author}手记，`)
        : '';
      const joiner = lang === 'en' ? '; ' : '，';
      const body = rendered.map((r) => r.text).join(joiner);
      sentences.push({
        id: nextSentenceId(plan.id),
        kind: 'claim',
        text: lang === 'en' ? `${prefix}${body}.` : `${prefix}${body}。`,
        claimIds: sorted.map((c) => c.id),
        defines: ownConcepts,
        uses: ownConcepts,
        guarded: sorted.flatMap((c) => c.qualifiers),
        decision: 'reuse',
        reason: needsTranslation ? '部分内容为原文引用，待译' : '研究手记，语气与限定保留',
        sources: sorted.map((c) => c.locator),
        needsTranslation,
      });
    }
  }

  // 比较句：同一主题下跨实物的比较，两边都需独立依据。
  if (items.length >= 2) {
    const comparison = buildComparison(claims, '用途', items);
    if (comparison.sides.every((s) => s.claim)) {
      const sidesText = comparison.sides.map((side) => {
        const entity = registry.get(side.entityId);
        const name = entity?.aliases[0] ?? side.entityId;
        const rendered = renderClaim(side.claim, lang).text;
        return lang === 'en'
          ? `${name}: per ${side.claim.author}, ${rendered}`
          : `${name}：据${side.claim.author}，${rendered}`;
      });
      const text = lang === 'en'
        ? `Comparison of use: ${sidesText.join('; ')}.`
        : `用途比较：${sidesText.join('；')}。`;
      sentences.push({
        id: nextSentenceId(plan.id),
        kind: 'comparison',
        text,
        claimIds: comparison.sides.map((s) => s.claim.id),
        defines: [],
        uses: comparison.sides.flatMap((s) => conceptsIn(s.claim.text)),
        guarded: comparison.sides.flatMap((s) => s.claim.qualifiers),
        decision: comparison.verdict === 'ok-assertion' ? 'reuse' : comparison.verdict === 'sourced-only' ? 'sourced-comparison' : 'defer',
        reason: comparison.reason,
        sources: comparison.sides.map((s) => s.claim.locator),
      });
    } else {
      issues.push({ kind: 'comparison-deferred', note: `用途比较暂缓：${comparison.reason}` });
    }
  }

  // 术语释义句：本柜用到而未定义、前站同语言也未给出的概念，补释义；释义必须有同语言出处。
  const definedHere = new Set(sentences.flatMap((s) => s.defines));
  const usedConcepts = [...new Set(sentences.flatMap((s) => s.uses))].filter((k) => !definedHere.has(k));
  for (const key of usedConcepts) {
    if (route.upstreamConcepts?.has(`${lang}:${key}`)) continue;
    const entry = glossary[key];
    const gloss = entry?.[lang === 'en' ? 'en' : 'zh'];
    if (!gloss) {
      issues.push({ kind: 'concept-needs-gloss', concept: key, note: `术语「${key}」缺少${lang === 'en' ? '英文' : '中文'}释义出处，需补译或补释义` });
      continue;
    }
    sentences.push({
      id: nextSentenceId(plan.id),
      kind: 'glossary',
      text: lang === 'en'
        ? `${gloss.term}: ${gloss.gloss} (source: ${gloss.source.record}).`
        : `${gloss.term}：${gloss.gloss}（据 ${gloss.source.record}）。`,
      claimIds: [],
      defines: [key],
      uses: [],
      guarded: guardedTokensIn(gloss.gloss),
      decision: 'reuse',
      reason: '本柜首次使用该术语，补释义',
      sources: [gloss.source],
    });
  }

  // 句子判定：译文冲突（只追究责任方）、待确认别名、待译内容一律暂缓。
  for (const sentence of sentences) {
    const backing = sentence.claimIds.map((id) => claims.find((c) => c.id === id)).filter(Boolean);
    const conflicted = backing.flatMap((c) => openConflictsAgainst(conflicts, c.id));
    const pendingAlias = backing.find((c) => c.subject.kind === 'object' && c.subject.confirmed === false);
    if (conflicted.length > 0) {
      sentence.decision = 'defer';
      sentence.reason = `译文冲突未决：${conflicted.map((c) => c.id).join('、')}`;
    } else if (pendingAlias) {
      sentence.decision = 'defer';
      sentence.reason = `别名待确认：${pendingAlias.subject.via}`;
    } else if (sentence.needsTranslation) {
      sentence.decision = 'defer';
      sentence.reason = '含未识别句式，待译审';
    }
  }

  // 容量适配：只统计可发布句。先删节（只删出处前缀），再按比较句、术语句、
  // 后站可见句、其他研究句的顺序暂缓；馆藏卡句不暂缓；任何删节不得动限定语与争议方。
  const publishable = () => sentences.filter((s) => s.decision === 'reuse' || s.decision === 'sourced-comparison');
  const totalLength = () => measureText(publishable().map((s) => s.text).join(''), measure);
  const disputes = disputeGroups(claims);
  const dropSentence = (sentence, note) => {
    sentence.decision = 'defer';
    sentence.reason = note;
    issues.push({ kind: 'deferred-for-capacity', sentenceId: sentence.id, note });
  };
  if (totalLength() > plan.limitNumber) {
    for (const s of publishable().filter((x) => x.kind === 'comparison')) dropSentence(s, '容量不足，比较句暂缓');
  }
  if (totalLength() > plan.limitNumber) {
    for (const s of publishable().filter((x) => x.kind === 'glossary')) dropSentence(s, '容量不足，术语释义未纳入本柜');
  }
  if (totalLength() > plan.limitNumber) {
    for (const s of publishable().filter((x) => x.kind === 'claim')) {
      if (totalLength() <= plan.limitNumber) break;
      const shortened = shortenSentence(s);
      if (shortened) {
        issues.push({ kind: 'shortened', sentenceId: s.id, note: '简版删去处前缀（出处留于句子来源），限定语保留' });
        s.text = shortened;
      }
    }
  }
  if (totalLength() > plan.limitNumber) {
    const laterCovered = publishable().filter((s) => s.kind === 'claim'
      && s.claimIds.some((id) => {
        const claim = claims.find((c) => c.id === id);
        return claim?.subject.kind === 'object' && route.laterItems?.has(claim.subject.entityId);
      }));
    for (const s of laterCovered) dropSentence(s, '容量不足，该实物于后续展位展出，此句暂缓');
  }
  if (totalLength() > plan.limitNumber) {
    const droppable = publishable().filter((s) => s.kind === 'claim'
      && !s.claimIds.some((id) => disputes.some((g) => g.some((c) => c.id === id))));
    for (const s of droppable) {
      if (totalLength() <= plan.limitNumber) break;
      dropSentence(s, '容量不足，研究句暂缓');
    }
  }
  if (totalLength() > plan.limitNumber) {
    issues.push({ kind: 'over-limit', note: `可发布文字仍超出容量 ${plan.limitNumber}，需编辑裁定，不得删去限定或争议一方` });
  }

  // 适配后校验：本柜使用却无人给出的术语（释义句可能因容量被暂缓）。
  const finalDefines = new Set(publishable().flatMap((s) => s.defines));
  for (const key of [...new Set(publishable().flatMap((s) => s.uses))]) {
    if (!finalDefines.has(key) && !route.upstreamConcepts?.has(`${lang}:${key}`)) {
      issues.push({ kind: 'concept-undefined', concept: key, note: `术语「${key}」在本柜使用但未给出释义，需补释义或调整比较对象` });
    }
  }

  return {
    caseId: plan.id,
    stop: plan.stop,
    language: lang,
    limit: plan.limitNumber,
    measure,
    sentences,
    issues,
    defines: [...new Set(publishable().flatMap((s) => s.defines))],
    uses: [...new Set(publishable().flatMap((s) => s.uses))],
    publishableText: publishable().map((s) => s.text).join(lang === 'en' ? ' ' : ''),
    publishableLength: totalLength(),
  };
}
