// 实体登记：实物 / 类型 / 地名 三类指称的区分，别名确认，误合与拆分。
// 所有年代只按原文保留，结构化范围仅供比较，绝不替代原文。

const ZH_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// 年代解析：保留原文 raw，另给出世纪范围供内部比较。
export function parsePeriod(raw) {
  const text = String(raw).trim();
  const circa = text.includes('约');
  const range = text.match(/([一二三四五六七八九十]+)至([一二三四五六七八九十]+)世纪/);
  const single = text.match(/([一二三四五六七八九十]+)世纪/);
  let startCentury = null;
  let endCentury = null;
  if (range) {
    startCentury = ZH_DIGITS[range[1]] ?? null;
    endCentury = ZH_DIGITS[range[2]] ?? null;
  } else if (single) {
    startCentury = ZH_DIGITS[single[1]] ?? null;
    endCentury = startCentury;
  }
  return { raw: text, circa, startCentury, endCentury };
}

// 类型指称：谈的是"同类器物"而非某一件实物。
const TYPE_PATTERNS = [/同类/, /同一类/, /此类/, /\banother\b[\s\S]*\bbowl\b/i, /\bsame\s+type\b/i, /\bsimilar\s+bowl/i];
// 地名指称：坑、坡、遗迹、存放间等出土地点，不是器物也不是年代。
const PLACE_PATTERNS = [/坑/, /遗迹/, /存放间/, /住址/, /[东西南北]坡/, /\bpit\b/i, /\bslope\b/i, /\bstorage\b/i, /\bdwelling\b/i];

export function classifyFreeName(name) {
  if (TYPE_PATTERNS.some((p) => p.test(name))) return 'type';
  if (PLACE_PATTERNS.some((p) => p.test(name))) return 'place';
  return null;
}

export class EntityRegistry {
  #entities = new Map();
  #aliases = new Map();

  constructor(artifacts = []) {
    for (const row of artifacts) this.addArtifact(row);
  }

  addArtifact(row) {
    const entity = {
      id: row.id,
      museum: row.museum,
      aliases: [row.alias],
      period: parsePeriod(row.period),
      card: row.label,
      status: 'active',
      mergedFrom: null,
    };
    this.#entities.set(row.id, entity);
    // 馆藏卡自带的别名视为已确认
    this.#aliases.set(row.alias, { entityId: row.id, status: 'confirmed', origin: 'card' });
    return entity;
  }

  get(id) {
    return this.#entities.get(id) ?? null;
  }

  list() {
    return [...this.#entities.values()];
  }

  aliasStatus(alias) {
    return this.#aliases.get(alias) ?? null;
  }

  // 编辑确认别名：确认前引用该别名的主张一律挂起。
  confirmAlias(alias, entityId) {
    if (!this.#entities.has(entityId)) {
      throw new Error(`无法确认别名：没有实物 ${entityId}`);
    }
    this.#aliases.set(alias, { entityId, status: 'confirmed', origin: 'editor' });
    const entity = this.#entities.get(entityId);
    if (!entity.aliases.includes(alias)) entity.aliases.push(alias);
  }

  proposeAlias(alias, entityId) {
    if (!this.#entities.has(entityId)) {
      throw new Error(`无法登记别名：没有实物 ${entityId}`);
    }
    this.#aliases.set(alias, { entityId, status: 'pending', origin: 'editor' });
  }

  // 名称解析：先查别名登记，再按语境区分类型与地名。
  resolveName(name) {
    const alias = this.#aliases.get(name);
    if (alias) {
      return { kind: 'object', entityId: alias.entityId, via: name, confirmed: alias.status === 'confirmed' };
    }
    const kind = classifyFreeName(name);
    if (kind === 'type') return { kind: 'type', text: name };
    if (kind === 'place') return { kind: 'place', text: name };
    return null;
  }

  // 模拟误合：多条实物被并成一条记录，别名全部挂到合并记录上。
  mergeEntities(ids, mergedId) {
    const parts = ids.map((id) => {
      const entity = this.#entities.get(id);
      if (!entity) throw new Error(`无法合并：没有实物 ${id}`);
      return entity;
    });
    const merged = {
      id: mergedId,
      museum: parts.map((p) => p.museum).join('、'),
      aliases: [...new Set(parts.flatMap((p) => p.aliases))],
      period: parts[0].period,
      card: parts.map((p) => p.card).join('；'),
      status: 'merged',
      mergedFrom: ids,
    };
    for (const id of ids) this.#entities.delete(id);
    this.#entities.set(mergedId, merged);
    for (const alias of merged.aliases) {
      this.#aliases.set(alias, { entityId: mergedId, status: 'confirmed', origin: 'merge' });
    }
    return merged;
  }

  // 拆开误合：parts 为拆分后的实物规格（通常取自馆藏卡原记录）。
  // 返回受影响的别名，供主张层重新归属；证据不会复制给拆出的对象。
  splitEntity(mergedId, parts) {
    const merged = this.#entities.get(mergedId);
    if (!merged) throw new Error(`无法拆分：没有记录 ${mergedId}`);
    this.#entities.delete(mergedId);
    for (const [alias, entry] of this.#aliases) {
      if (entry.entityId === mergedId) this.#aliases.delete(alias);
    }
    const rebound = [];
    for (const part of parts) {
      const entity = this.addArtifact({
        id: part.id,
        museum: part.museum ?? merged.museum,
        alias: part.alias,
        period: part.period ?? merged.period.raw,
        label: part.label ?? '',
      });
      entity.status = 'active';
      rebound.push(...entity.aliases);
    }
    return { mergedId, parts: parts.map((p) => p.id), reboundAliases: rebound };
  }
}
