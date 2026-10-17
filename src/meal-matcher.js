/**
 * 治愈系套餐匹配（业务规范 v2）
 * ------------------------------------------------------------------
 * 硬约束：总热量 ≤ CalorieMax。
 * 目标：在合规候选里，找「性价比最高 / 折扣力度最大」的那个。
 *
 *   score = 0.40 × 折扣力度
 *         + 0.35 × 性价比（每元获得的热量，按候选集内最大值归一）
 *         + 0.25 × 额度利用率
 *
 * 为什么还要留 25% 的额度利用率：纯按折扣排序会退化成"买最便宜的打折品"，
 * L4 拿着 2000 kcal 的额度被推荐一杯 9.9 元冰美式，是明显的产品事故。
 *
 * 「点两份」：菜单里最顶的套餐也就 949 kcal，2000 的额度单份永远用不满。
 * 所以对打折套餐额外生成一个 ×2 候选（热量、价格、优惠同倍放大，折扣率不变），
 * 让 L4 有真正配得上这个额度的答案；放不进额度的 ×2 候选不会进入候选集。
 */

const W = { discount: 0.4, value: 0.35, utilization: 0.25 };

/** 最多允许点几份 */
const MAX_PORTIONS = 2;

/**
 * 把同款套餐复制成 N 份的候选（折扣率不变，绝对热量/价格同倍放大）
 * @param {object} product
 * @param {number} portions
 */
function multiplyPortion(product, portions) {
  const components = product.components
    ? product.components.map((c) => ({ ...c, qty: c.qty * portions, kcal: c.kcal * portions }))
    : null;

  return {
    ...product,
    code: `${product.code}#x${portions}`,
    baseCode: product.code,
    baseName: product.name,
    name: `${product.name} ×${portions}`,
    portions,
    components,
    kcal: product.kcal * portions,
    price: round2(product.price * portions),
    originalPrice: round2(product.originalPrice * portions),
    saved: round2(product.saved * portions),
    kcalSource: `${product.kcalSource}（×${portions} 份）`,
  };
}

/**
 * @param {object[]} products  buildCatalog 产出的商品
 * @param {number|null} calorieMax  热量上限；null 表示不限
 * @param {object} [options]
 * @param {number} [options.referenceKcal] 不限额度时用于计算利用率的参考值
 * @param {number} [options.maxPortions]   同款最多点几份（默认 2，传 1 关闭）
 */
export function matchHealingMeal(products, calorieMax, { referenceKcal = 2000, maxPortions = MAX_PORTIONS } = {}) {
  const unlimited = calorieMax === null || calorieMax === undefined;
  const cap = unlimited ? null : Number(calorieMax);
  const reference = unlimited || !cap ? referenceKcal : cap;

  const usable = (products ?? []).filter((p) => Number.isFinite(p.kcal) && p.kcal >= 0);

  // 基础候选 + 同款多份候选
  const candidates = [...usable];
  const portionLimit = Math.max(1, Math.min(Number(maxPortions) || 1, 4));
  for (const product of usable) {
    if (product.kind !== 'combo') continue; // 只让套餐叠加，单品叠加没有优惠故事
    if (!(product.discountRate > 0)) continue;
    for (let portions = 2; portions <= portionLimit; portions += 1) {
      const doubled = multiplyPortion(product, portions);
      if (cap !== null && doubled.kcal > cap) break; // 再多只会更超
      candidates.push(doubled);
    }
  }

  const fitting = cap === null ? [...candidates] : candidates.filter((p) => p.kcal <= cap);
  const overBudget = cap === null ? [] : candidates.filter((p) => p.kcal > cap);

  const summarizeOver = () =>
    overBudget
      .map((p) => ({ name: p.name, kcal: p.kcal, over: p.kcal - cap }))
      .sort((a, b) => a.over - b.over);

  if (fitting.length === 0) {
    return {
      calorieMax: cap,
      referenceKcal: reference,
      primary: null,
      alternates: [],
      nearMiss: pickNearMiss(overBudget, cap),
      overBudget: summarizeOver(),
      stats: { total: usable.length, fitting: 0, combos: 0, singles: 0, doubles: 0 },
    };
  }

  // 性价比按候选集内最大值归一，避免跨档位量纲漂移
  const maxValue = Math.max(...fitting.map((p) => (p.price > 0 ? p.kcal / p.price : 0)), 0.0001);

  const scored = fitting.map((product) => {
    const utilization = reference > 0 ? product.kcal / reference : 0;
    const valueIndex = product.price > 0 ? product.kcal / product.price : 0;
    const valueNorm = valueIndex / maxValue;

    const score =
      W.discount * product.discountRate + W.value * valueNorm + W.utilization * Math.min(utilization, 1);

    return {
      ...product,
      metrics: {
        utilization: round2(utilization),
        valueIndex: round1(valueIndex),
        valueNorm: round2(valueNorm),
        discountRate: round4(product.discountRate),
      },
      score: round2(score * 100),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    calorieMax: cap,
    referenceKcal: reference,
    primary: scored[0],
    alternates: scored.slice(1, 4),
    nearMiss: pickNearMiss(overBudget, cap),
    overBudget: summarizeOver(),
    stats: {
      total: usable.length,
      fitting: fitting.length,
      combos: scored.filter((p) => p.kind === 'combo' && !p.portions).length,
      singles: scored.filter((p) => p.kind === 'single').length,
      doubles: scored.filter((p) => p.portions > 1).length,
    },
  };
}

/** 差一点点就够得着的套餐——不推荐，但值得让用户知道它存在 */
function pickNearMiss(overBudget, cap) {
  if (cap === null || cap === undefined || overBudget.length === 0) return null;
  const close = overBudget.filter((p) => p.kcal <= cap * 1.15);
  if (close.length === 0) return null;
  close.sort((a, b) => a.kcal - b.kcal || b.discountRate - a.discountRate);
  const pick = close[0];
  return { name: pick.name, kcal: pick.kcal, over: pick.kcal - cap, price: pick.price };
}

/** 还原成可直接展示的单品串，如 "巨无霸 + 中薯条 + 可乐中杯" */
export function formatComponents(product) {
  if (!product) return '';
  const portions = Number(product.portions ?? 1);
  if (product.components?.length) {
    // 多份时写成 (A + B) × 2，比 A×2 + B×2 + C×2 更好读，也更少歧义
    const base = product.components
      .map((c) => {
        const qty = Math.round(c.qty / portions);
        return qty > 1 ? `${c.name}×${qty}` : c.name;
      })
      .join(' + ');
    return portions > 1 ? `（${base}）× ${portions}` : base;
  }
  return product.name;
}

/** 结账口径的优惠描述 */
export function formatDiscount(product) {
  if (!product) return '';
  if (!product.saved || product.saved <= 0) {
    return `¥${product.price.toFixed(1)}（无优惠）`;
  }
  return `¥${product.price.toFixed(1)}（原价 ¥${product.originalPrice.toFixed(1)}，省 ¥${product.saved.toFixed(1)}，约 ${(product.discountRate * 100).toFixed(1)}% off）`;
}

export { W as MATCHER_WEIGHTS };

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
