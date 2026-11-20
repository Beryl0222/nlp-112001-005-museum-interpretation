import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntityRegistry, parsePeriod } from '../src/entities.js';

const artifacts = [
  { id: 'q-31', museum: '岭西馆', alias: '回纹口钵', period: '约三至五世纪', label: '出土于西坡疑似仪式坑南侧' },
  { id: 'q-38', museum: '岭西馆', alias: '坡口钵', period: '五世纪', label: '出土于北坡住址遗迹，口沿有回纹' },
  { id: 'a-11', museum: '雪线馆', alias: 'ridge bowl', period: '约四世纪', label: '工具存放间附近发现，坑体用途不详' },
];

test('年代保留原文，另给出世纪范围与约略标记', () => {
  const ranged = parsePeriod('约三至五世纪');
  assert.equal(ranged.raw, '约三至五世纪');
  assert.equal(ranged.circa, true);
  assert.equal(ranged.startCentury, 3);
  assert.equal(ranged.endCentury, 5);
  const single = parsePeriod('五世纪');
  assert.equal(single.circa, false);
  assert.equal(single.startCentury, 5);
  assert.equal(single.endCentury, 5);
  const circa = parsePeriod('约四世纪');
  assert.equal(circa.circa, true);
  assert.equal(circa.startCentury, 4);
});

test('名称按语境区分实物、类型与地名', () => {
  const registry = new EntityRegistry(artifacts);
  const object = registry.resolveName('回纹口钵');
  assert.equal(object.kind, 'object');
  assert.equal(object.entityId, 'q-31');
  assert.equal(object.confirmed, true);
  const type = registry.resolveName('另一个同类钵');
  assert.equal(type.kind, 'type');
  const place = registry.resolveName('西坡疑似仪式坑');
  assert.equal(place.kind, 'place');
  assert.equal(registry.resolveName('无此物'), null);
});

test('别名确认前为待确认，确认后解析到实物', () => {
  const registry = new EntityRegistry(artifacts);
  registry.proposeAlias('rimmed bowl', 'q-31');
  const pending = registry.resolveName('rimmed bowl');
  assert.equal(pending.kind, 'object');
  assert.equal(pending.confirmed, false);
  registry.confirmAlias('rimmed bowl', 'q-31');
  assert.equal(registry.resolveName('rimmed bowl').confirmed, true);
  assert.throws(() => registry.confirmAlias('x', 'q-99'), /没有实物/);
});

test('误合后别名挂到合并记录，拆分后按原记录回弹', () => {
  const registry = new EntityRegistry(artifacts);
  registry.mergeEntities(['q-31', 'q-38'], 'q-he');
  assert.equal(registry.get('q-31'), null);
  assert.equal(registry.resolveName('回纹口钵').entityId, 'q-he');
  assert.equal(registry.resolveName('坡口钵').entityId, 'q-he');
  registry.splitEntity('q-he', [
    { id: 'q-31', alias: '回纹口钵', museum: '岭西馆', period: '约三至五世纪', label: '出土于西坡疑似仪式坑南侧' },
    { id: 'q-38', alias: '坡口钵', museum: '岭西馆', period: '五世纪', label: '出土于北坡住址遗迹，口沿有回纹' },
  ]);
  assert.equal(registry.resolveName('回纹口钵').entityId, 'q-31');
  assert.equal(registry.resolveName('坡口钵').entityId, 'q-38');
  assert.equal(registry.list().length, 3);
});
