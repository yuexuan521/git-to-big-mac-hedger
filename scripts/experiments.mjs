#!/usr/bin/env node
/**
 * 参数敏感性实验
 * ------------------------------------------------------------------
 * 复现 docs/ALGORITHM.md §2.1 / §2.2 / §5.1 中的三张表。
 *
 * 为什么单独写一个脚本：权重是"拍脑袋还是有依据"，靠文字说不清，
 * 靠一张可复现的扫描表才说得清。
 *
 * 用法：npm run experiment
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadCaptures, buildCatalog } from '../src/catalog.js';
import { LEVELS, resolveLevel, calorieMaxOf } from '../src/levels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = buildCatalog(await loadCaptures(path.join(ROOT, 'data', 'live')));

const SCENARIOS = [
  { id: 'l1', added: 18, deleted: 4, commits: 2 },
  { id: 'l2', added: 180, deleted: 40, commits: 4 },
  { id: 'l3', added: 380, deleted: 180, commits: 7 },
  { id: 'l4', added: 700, deleted: 320, commits: 13 },
];

const fmt = (n) => Math.round(n);

function scoreOf(s, { added, deleted, commit }) {
  return s.added * added + s.deleted * deleted + s.commits * commit;
}

function levelOf(score) {
  return resolveLevel(score).id;
}

/* ------------------------------------------------------------------ */
/* 1. 提交权重扫描                                                      */
/* ------------------------------------------------------------------ */

console.log('提交权重扫描（新增 1.0 / 删除 1.5）');
console.log('commit_w | l1 | l2 | l3 | l4');
for (const commit of [20, 30, 40, 50]) {
  const row = SCENARIOS.map((s) => {
    const score = scoreOf(s, { added: 1.0, deleted: 1.5, commit });
    return `${fmt(score)}/${levelOf(score)}`;
  });
  console.log(`${String(commit).padStart(8)} | ${row.join(' | ')}`);
}

console.log('\n删除权重扫描（新增 1.0 / 提交 30）');
console.log('delete_w | l1 | l2 | l3 | l4');
for (const deleted of [1.0, 1.5, 2.0, 2.5]) {
  const row = SCENARIOS.map((s) => {
    const score = scoreOf(s, { added: 1.0, deleted, commit: 30 });
    return `${fmt(score)}/${levelOf(score)}`;
  });
  console.log(`${String(deleted).padStart(8)} | ${row.join(' | ')}`);
}

/* ------------------------------------------------------------------ */
/* 2. 匹配权重扫描                                                      */
/* ------------------------------------------------------------------ */

function candidates(budget, maxPortions = 2) {
  const usable = catalog.products.filter((p) => Number.isFinite(p.kcal) && p.kcal >= 0);
  const list = [...usable];

  for (const product of usable) {
    if (product.kind !== 'combo' || !(product.discountRate > 0)) continue;
    for (let portions = 2; portions <= maxPortions; portions += 1) {
      if (product.kcal * portions > budget) break;
      const price = Number((product.price * portions).toFixed(2));
      const originalPrice = Number((product.originalPrice * portions).toFixed(2));
      list.push({
        ...product,
        name: `${product.name} ×${portions}`,
        portions,
        kcal: product.kcal * portions,
        price,
        originalPrice,
        saved: Math.max(0, originalPrice - price),
      });
    }
  }

  return list.filter((p) => p.kcal <= budget);
}

function bestOf(budget, weights) {
  const fitting = candidates(budget);
  const maxValue = Math.max(...fitting.map((p) => p.kcal / p.price), 0.0001);
  const scored = fitting.map((p) => ({
    name: p.name,
    kcal: p.kcal,
    score:
      weights.discount * p.discountRate +
      weights.value * (p.kcal / p.price) / maxValue +
      weights.utilization * Math.min(p.kcal / budget, 1),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

const WEIGHT_SETS = {
  '0.40/0.35/0.25 基线': { discount: 0.4, value: 0.35, utilization: 0.25 },
  '0.60/0.20/0.20 折扣优先': { discount: 0.6, value: 0.2, utilization: 0.2 },
  '0.20/0.55/0.25 性价比优先': { discount: 0.2, value: 0.55, utilization: 0.25 },
  '0.33/0.34/0.33 均等': { discount: 0.33, value: 0.34, utilization: 0.33 },
};

const budgets = LEVELS.map((level) => ({ id: level.id, budget: calorieMaxOf(level) }));
console.log('\n匹配权重扫描（每格为 top-1 推荐）');
for (const [label, weights] of Object.entries(WEIGHT_SETS)) {
  const picks = budgets.map(({ budget }) => {
    const best = bestOf(budget, weights);
    return best ? `${best.name} ${best.kcal}` : '—';
  });
  console.log(`${label} | ${picks.join(' | ')}`);
}

console.log('\n候选规模');
for (const { id, budget } of budgets) {
  console.log(`${id} budget=${budget} candidates=${candidates(budget).length}`);
}
