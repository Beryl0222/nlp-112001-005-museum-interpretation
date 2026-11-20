// 发布与版本：发布门控（暂缓句不出柜）、观众视图（当前生效文字与可公开出处）、
// 研究员视图（历史版本与当时判断）。未决冲突留在编辑端。

export class PublicationStore {
  constructor(state = {}) {
    this.versions = new Map(Object.entries(state.versions ?? {}));
  }

  static sourcePublic(source, claimsById, conflicts) {
    // 卡片与未涉冲突的原始手记可公开；涉未决冲突的译稿不出现在公开出处。
    const claim = claimsById.get(source.record);
    if (claim?.sourceKind === 'translation') {
      const open = conflicts.some(
        (c) => c.status === 'open' && (c.claimIds.includes(claim.id) || c.relatedClaimIds.includes(claim.id)),
      );
      if (open) return false;
    }
    return true;
  }

  // 发布：只收判定为可沿用或带出处比较的句子；暂缓句留在编辑端并记录原因。
  publish(label, { by, note = '', claimsById, conflicts }) {
    const accepted = label.sentences.filter((s) => s.decision === 'reuse' || s.decision === 'sourced-comparison');
    if (accepted.length === 0) {
      throw new Error(`展柜 ${label.caseId} 没有可发布的句子`);
    }
    const withheld = label.sentences
      .filter((s) => s.decision === 'defer')
      .map((s) => ({ sentenceId: s.id, reason: s.reason }));
    const sources = [];
    for (const s of accepted) {
      for (const src of s.sources) {
        if (PublicationStore.sourcePublic(src, claimsById, conflicts)
            && !sources.some((x) => x.record === src.record && x.start === src.start && x.field === src.field)) {
          sources.push(src);
        }
      }
    }
    const list = this.versions.get(label.caseId) ?? [];
    const version = {
      n: list.length + 1,
      caseId: label.caseId,
      language: label.language,
      at: new Date().toISOString(),
      by,
      note,
      text: accepted.map((s) => s.text).join(label.language === 'en' ? ' ' : ''),
      sentences: accepted.map((s) => ({ id: s.id, kind: s.kind, decision: s.decision, text: s.text })),
      withheld,
      sources,
      openConflicts: conflicts.filter((c) => c.status === 'open').map((c) => c.id),
    };
    list.push(version);
    this.versions.set(label.caseId, list);
    return version;
  }

  // 观众扫展柜编号：只看当前生效版本与可公开出处。
  visitorView(caseId, plan) {
    const list = this.versions.get(caseId) ?? [];
    const current = list.at(-1);
    if (!current) return null;
    return {
      caseId,
      stop: plan?.stop ?? null,
      language: current.language,
      text: current.text,
      sources: current.sources,
      version: current.n,
    };
  }

  // 研究员回看：每个版本的句子判定、暂缓原因、当时的未决冲突。
  history(caseId) {
    return (this.versions.get(caseId) ?? []).map((v) => ({
      n: v.n,
      at: v.at,
      by: v.by,
      note: v.note,
      language: v.language,
      text: v.text,
      sentences: v.sentences,
      withheld: v.withheld,
      openConflicts: v.openConflicts,
    }));
  }

  toJSON() {
    return { versions: Object.fromEntries(this.versions) };
  }
}
