/**
 * 目录归一化层
 * ------------------------------------------------------------------
 * 真实 mcd-mcp 的数据是分三处来的，必须拼起来才能算热量：
 *
 *   query-meals        → 商品编码、名称、现价、划线价
 *   list-nutrition-foods → 按「商品名」给的热量（没有编码！）
 *   query-meal-detail    → 套餐由哪几项组成（默认选配）
 *
 * 所以核心难点是**按名字对齐**：菜单写"新地"，营养表写"朱古力新地"；
 * 菜单写"薯条"，营养表写"中薯条/大薯条/小薯条"。
 * 这里用「归一化 + 别名表 + 明确失败」三件套处理：
 * 对不上就返回 null 并把该商品记为未解析，绝不猜一个热量糊弄过去。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 菜单名 → 营养表名（键值均为 normalizeName 之后的形式） */
const ALIASES = {
  新地: '朱古力新地',
  派: '香芋派',
  薯条: '中薯条',
  可乐: '可乐中杯',
  麦乐鸡: '麦乐鸡5块',
  麦辣鸡翅: '麦辣鸡翅-2块',
  玉米杯: '小杯玉米杯',
  经典麦旋风: '奥利奥麦旋风',
  麦咖啡美式: '热美式中杯',
  '100%苹果汁(盒装)': '100%苹果汁',
  '那么大鸡排(椒盐风味)': '那么大鸡排',
};

/** 去掉空格、™、全角括号，统一小写，让名字可比 */
export function normalizeName(name) {
  return String(name ?? '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[™®]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 营养表 → Map<归一化名, kcal> */
export function buildNutritionIndex(nutritionCapture) {
  const index = new Map();
  for (const item of nutritionCapture?.items ?? []) {
    const key = normalizeName(item.name);
    if (!index.has(key)) index.set(key, { name: item.name, kcal: Number(item.kcal) });
  }
  return index;
}

/**
 * 按名字查热量。查不到返回 null——调用方必须显式处理，不允许兜底估算。
 * @returns {number|null}
 */
export function resolveKcal(name, nutritionIndex) {
  const key = normalizeName(name);
  if (nutritionIndex.has(key)) return nutritionIndex.get(key).kcal;

  const alias = ALIASES[key];
  if (alias && nutritionIndex.has(normalizeName(alias))) return nutritionIndex.get(normalizeName(alias)).kcal;

  // 去掉结尾的括号说明再试一次，例如 "浓浓黑巧(冰/热)"
  const stripped = key.replace(/\([^)]*\)$/, '');
  if (stripped !== key && nutritionIndex.has(stripped)) return nutritionIndex.get(stripped).kcal;

  return null;
}

/**
 * 读取 data/live/ 下的快照
 * @param {string} dir
 */
export async function loadCaptures(dir) {
  const read = async (file) => JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  const [stores, menu, nutrition, details, coupons] = await Promise.all([
    read('stores.json'),
    read('menu-1450750.json'),
    read('nutrition.json'),
    read('meal-details.json'),
    read('coupons.json'),
  ]);
  return { stores, menu, nutrition, details, coupons };
}

/**
 * 把三份数据拼成统一的商品目录
 * @param {object} captures loadCaptures 的返回值
 * @param {object} [options]
 * @param {string} [options.storeCode] 指定门店（快照只有一个门店，传别的会提示）
 */
export function buildCatalog(captures, { storeCode } = {}) {
  const { menu, nutrition, details } = captures;
  const nutritionIndex = buildNutritionIndex(nutrition);
  const detailMap = details?.details ?? {};

  if (storeCode && menu.storeCode && storeCode !== menu.storeCode) {
    // 不静默回退：告诉调用方快照的门店与请求的不一致
    throw new Error(
      `快照门店为 ${menu.storeCode}（${menu.storeName}），与请求的 ${storeCode} 不一致。` +
        '请重新用 query-meals 抓取该门店的菜单快照。',
    );
  }

  const products = [];
  const unresolved = [];

  for (const item of menu.meals ?? []) {
    const price = Number(item.currentPrice);
    const originalPrice = Number(item.originalPrice ?? item.currentPrice);
    const detail = detailMap[item.code];

    const product = {
      code: item.code,
      name: item.name,
      category: item.category ?? 'other',
      price,
      originalPrice,
      saved: round2(Math.max(0, originalPrice - price)),
      discountRate: originalPrice > 0 ? round4(Math.max(0, originalPrice - price) / originalPrice) : 0,
      kind: detail ? 'combo' : 'single',
      components: null,
      kcal: null,
      kcalSource: null,
    };

    if (detail) {
      // 套餐：按默认选配逐项查热量后累加
      const components = [];
      let total = 0;
      let missing = null;

      for (const entry of detail.defaults ?? []) {
        const kcal = resolveKcal(entry.name, nutritionIndex);
        if (kcal === null) {
          missing = entry.name;
          break;
        }
        const qty = Number(entry.qty ?? 1);
        components.push({ name: entry.name, qty, kcal: kcal * qty });
        total += kcal * qty;
      }

      if (missing) {
        product.unresolvedReason = `成分「${missing}」不在营养表中，无法核算热量`;
        unresolved.push(product);
        continue;
      }

      product.components = components;
      product.kcal = Math.round(total);
      product.kcalSource = `query-meal-detail(${detail.traceId?.slice(0, 8) ?? 'n/a'}) + list-nutrition-foods`;
    } else {
      // 单品：直接按名字查
      const kcal = resolveKcal(item.name, nutritionIndex);
      if (kcal === null) {
        product.unresolvedReason = `「${item.name}」不在营养表中`;
        unresolved.push(product);
        continue;
      }
      product.kcal = Math.round(kcal);
      product.kcalSource = 'list-nutrition-foods';
    }

    products.push(product);
  }

  return {
    storeCode: menu.storeCode,
    storeName: menu.storeName,
    currency: menu.currency ?? 'CNY',
    products,
    unresolved,
    provenance: {
      stores: { capturedAt: captures.stores?.capturedAt, traceId: captures.stores?.traceId, tool: captures.stores?.tool },
      menu: { capturedAt: menu.capturedAt, traceId: menu.traceId, tool: menu.tool },
      nutrition: { capturedAt: nutrition.capturedAt, traceId: nutrition.traceId, tool: nutrition.tool },
      details: { capturedAt: details.capturedAt, tool: details.tool, count: Object.keys(detailMap).length },
      coupons: { capturedAt: captures.coupons?.capturedAt, available: captures.coupons?.available?.coupons?.length ?? 0 },
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
