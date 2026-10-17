/**
 * 输出渲染：赛博治愈对冲账单
 * ------------------------------------------------------------------
 * 账单主体严格按业务规范给定的字段与顺序输出；
 * 任何补充信息（备选、超预算提示、快照溯源）都放在分隔线之后，
 * 保证账单本身可以原样贴进周报或群里。
 */

import { formatComponents, formatDiscount } from './meal-matcher.js';

/* ------------------------------------------------------------------ */
/* 治愈寄语                                                            */
/* ------------------------------------------------------------------ */

const MESSAGES = {
  L1: [
    '今天没把自己榨干，这是本事，不是运气。',
    '收得住的人才跑得远，今天这样就很好。',
    '轻轻合上电脑——明天的你会谢谢现在的克制。',
  ],
  L2: [
    '你推的不是代码，是明天可以少解释一句的底气。',
    '稳定输出的人不显眼，但项目是靠他们活着的。',
    '没有戏剧性的今天，恰恰是最难得的今天。',
  ],
  L3: [
    '你今天啃下的那块，别人明天会绕道走。',
    '难的已经过去了，现在允许自己被一份薯条收买。',
    '脑力烧了一整天，碳水该来还债了。',
  ],
  L4: [
    '如果没有你，今天这个世界大概要塌一半。',
    '屎山是你拦下的，功德是你赚的，这顿是你应得的。',
    '别人看到的是"已恢复"，只有你知道那是通宵。',
  ],
};

export function healingMessage(level, score = 0) {
  const pool = MESSAGES[level?.id] ?? MESSAGES.L2;
  const idx = Math.abs(Math.round(score * 10)) % pool.length;
  return pool[idx];
}

/* ------------------------------------------------------------------ */
/* 账单主体                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {object} result
 * @param {object} result.effort       scoreEffort 结果
 * @param {object} result.level        resolveLevel 结果
 * @param {number|null} result.calorieMax
 * @param {object} result.meal         matchHealingMeal 结果
 */
export function renderInvoice(result) {
  const { effort, level, calorieMax, meal } = result;
  const { added, deleted } = effort.lines;
  const capText = calorieMax === null ? '不限（宇宙级功德，热量彻底解禁）' : `${calorieMax} kcal`;

  const lines = [];
  lines.push('### 🍔 赛博治愈对冲账单 (Cyber Healing Invoice)');
  lines.push('');
  lines.push(`* **今日工作量评估**：${level.id} ${level.name}（${level.en}）`);
  lines.push(`* **代码变动详情**：新增 ${added} 行 | 删除 ${deleted} 行 | 共 ${effort.commitCount} 次提交`);
  lines.push(`* **工作量得分**：${fmtScore(effort.score)} 分`);
  lines.push(`* **建议热量上限**：${capText}`);
  lines.push('');
  lines.push('#### 💖 麦当劳 MCP 推荐治愈套餐：');

  if (!meal.primary) {
    lines.push('');
    lines.push('- **套餐名称**：暂无合规套餐');
    lines.push('- **包含单品**：—');
    lines.push('- **预估总热量**：—');
    lines.push('- **优惠活动/价格**：—');
    lines.push(`- **治愈寄语**：${healingMessage(level, effort.score)}`);
  } else {
    const p = meal.primary;
    lines.push('');
    lines.push(`- **套餐名称**：${p.name}`);
    lines.push(`- **包含单品**：${formatComponents(p)}`);
    lines.push(
      `- **预估总热量**：${p.kcal} kcal${
        calorieMax === null
          ? `（不限额度，参考占用 ${(p.metrics.utilization * 100).toFixed(0)}%）`
          : `（额度占用 ${(p.metrics.utilization * 100).toFixed(0)}%）`
      }`,
    );
    lines.push(`- **优惠活动/价格**：${formatDiscount(p)}`);
    lines.push(`- **治愈寄语**：${healingMessage(level, effort.score)}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 补充信息                                                            */
/* ------------------------------------------------------------------ */

export function renderExtras(result) {
  const { effort, level, meal, catalog, next } = result;
  const out = [];

  if (meal.primary) {
    const utilLabel = meal.calorieMax === null ? '参考占用' : '额度利用率';
    out.push('#### 🔍 为什么是它');
    out.push('');
    out.push(
      `- 折扣力度 ${(meal.primary.metrics.discountRate * 100).toFixed(1)}% · 性价比 ${meal.primary.metrics.valueIndex.toFixed(1)} kcal/元 · ${utilLabel} ${(meal.primary.metrics.utilization * 100).toFixed(0)}%`,
    );
    out.push(
      `- 从 ${meal.stats.fitting} 个合规候选里选出（套餐 ${meal.stats.combos} 个${
        meal.stats.doubles ? ` / 双份 ${meal.stats.doubles} 个` : ''
      } / 单品 ${meal.stats.singles} 个），综合评分 ${meal.primary.score}`,
    );
    out.push(`- 热量核算：${meal.primary.kcalSource}`);
    if (meal.primary.portions > 1) {
      out.push(
        `- 单份 ${meal.primary.baseName} 只有 ${Math.round(meal.primary.kcal / meal.primary.portions)} kcal，装不满 ${meal.calorieMax} 的额度，所以按 ${meal.primary.portions} 份算——今天的功德配得上这个份量。`,
      );
    }
  }

  if (meal.alternates?.length) {
    out.push('');
    out.push('#### 🥈 备选方案');
    out.push('');
    out.push('| 套餐 | 热量 | 价格 | 折扣 | 评分 |');
    out.push('| --- | ---: | ---: | ---: | ---: |');
    for (const alt of meal.alternates) {
      out.push(
        `| ${alt.name} | ${alt.kcal} | ¥${alt.price.toFixed(1)} | ${(alt.discountRate * 100).toFixed(0)}% | ${alt.score} |`,
      );
    }
  }

  if (meal.nearMiss) {
    out.push('');
    out.push(
      `> 差一点点：**${meal.nearMiss.name}** ${meal.nearMiss.kcal} kcal，超出额度 ${meal.nearMiss.over} kcal。${
        level.id === 'L4' ? '宇宙级功德也装不下它，建议找个人分着吃。' : '再多搬两块砖就够得着了。'
      }`,
    );
  }

  if (next?.next && next.remaining > 0) {
    out.push('');
    out.push(
      `> 距离 **${next.next.id} ${next.next.name}**（额度 ${next.next.maxKcal} kcal）还差 **${next.remaining.toFixed(1)} 分**。`,
    );
  }

  // 不计分的上下文信号：只在这里出现，不参与评分
  const ctx = effort.context;
  const ctxBits = [];
  if (ctx.nightCommits) ctxBits.push(`深夜提交 ${ctx.nightCommits} 次`);
  if (ctx.weekendCommits) ctxBits.push(`周末提交 ${ctx.weekendCommits} 次`);
  if (ctx.hotfixCommits) ctxBits.push(`热修/回滚 ${ctx.hotfixCommits} 次`);
  if (ctxBits.length) {
    out.push('');
    out.push(`> 另：${ctxBits.join('、')}——这些不计入得分，但今天确实更累。`);
  }

  if (catalog) {
    out.push('');
    out.push(
      `> 数据源：门店 ${catalog.storeCode}（${catalog.storeName}）· 菜单快照 ${shortTime(catalog.provenance.menu.capturedAt)} · 营养表 ${shortTime(catalog.provenance.nutrition.capturedAt)}`,
    );
    if (catalog.unresolved.length) {
      const names = catalog.unresolved
        .map((p) => p.name)
        .slice(0, 3)
        .join('、');
      out.push(
        `> 已排除 ${catalog.unresolved.length} 个无法核算热量的商品（${names}${catalog.unresolved.length > 3 ? ' 等' : ''}），不做估算。`,
      );
    }
  }

  out.push('');
  out.push(
    '> 本项目为麦当劳程序员节创意开发大赛参赛作品，非麦当劳官方产品。餐品价格与供应状态以麦当劳官方渠道实时结果为准。',
  );

  return out.join('\n');
}

/** 一次跑多档时用的表行摘要 */
export function renderCompact(result) {
  const { level, effort, meal, calorieMax } = result;
  const p = meal.primary;
  return `| ${level.id} ${level.name} | ${fmtScore(effort.score)} | ${effort.lines.added}/${effort.lines.deleted}/${effort.commitCount} | ${
    calorieMax === null ? '不限' : calorieMax
  } | ${p ? p.name : '—'} | ${p ? `¥${p.price.toFixed(1)}` : '—'} | ${p ? p.kcal : '—'} |`;
}

function fmtScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function shortTime(iso) {
  if (!iso) return 'n/a';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(iso);
}
