/**
 * 工作量等级与热量上限（业务规范 v2）
 * ------------------------------------------------------------------
 * 与旧版的最大区别：额度是**固定档位值**，不再做"底薪 + 档内提成"的插值。
 * 判定只看 Score 落在哪一档，越简单越不容易解释不清。
 */

export const LEVELS = [
  {
    id: 'L1',
    name: '微光轻步',
    en: 'Chill',
    threshold: 0,
    maxKcal: 400,
    desc: '今天轻松搞定，维持充沛状态。',
  },
  {
    id: 'L2',
    name: '踏实前行',
    en: 'Normal',
    threshold: 100,
    maxKcal: 700,
    desc: '踏实推进业务，脑力平稳燃烧。',
  },
  {
    id: 'L3',
    name: '破浪攻坚',
    en: 'Hardcore',
    threshold: 500,
    maxKcal: 1100,
    desc: '攻克核心难点，身体急需碳水补充！',
  },
  {
    id: 'L4',
    name: '拯救世界',
    en: 'Legendary',
    threshold: 1200,
    // null 表示不限；默认取 2000，可用 --unlimited 切到真正无上限
    maxKcal: 2000,
    desc: '拯救屎山代码，宇宙级功德！今晚热量彻底解禁！',
  },
];

export const LEVEL_ORDER = LEVELS.map((l) => l.id);

/**
 * 按 Score 判定等级。区间左闭右开：score < 100 → L1，依此类推。
 * @param {number} score
 */
export function resolveLevel(score) {
  const safe = Number.isFinite(score) ? score : 0;
  let matched = LEVELS[0];
  for (const level of LEVELS) {
    if (safe >= level.threshold) matched = level;
  }
  return matched;
}

export function getLevelById(id) {
  return LEVELS.find((l) => l.id === String(id).toUpperCase()) ?? null;
}

/** 本档热量上限；L4 可配成无限（返回 null） */
export function calorieMaxOf(level, { unlimited = false } = {}) {
  if (level.id === 'L4' && unlimited) return null;
  return level.maxKcal;
}

/** 距下一档还差多少分（已在最高档返回 next=null） */
export function pointsToNextLevel(score) {
  const level = resolveLevel(score);
  const index = LEVELS.indexOf(level);
  const next = LEVELS[index + 1];
  if (!next) return { next: null, remaining: 0 };
  return { next, remaining: Math.max(0, next.threshold - score) };
}

/** 展示用区间文本，如 "500 – 1199" / "1200 +" */
export function rangeLabel(level) {
  const index = LEVELS.indexOf(level);
  const next = LEVELS[index + 1];
  return next ? `${level.threshold} – ${next.threshold - 1}` : `${level.threshold} +`;
}
