/**
 * 业务规范 v2 的测试基线
 * ------------------------------------------------------------------
 * 覆盖五层：
 *   1. 评分     — Score = 增×1.0 + 删×1.5 + 提交×30，深夜/周末/热修不计分
 *   2. 等级     — 100 / 500 / 1200 三个断点，固定额度 400 / 700 / 1100 / 2000
 *   3. 数据     — 真实 mcd-mcp 快照能拼成目录，名字对不上就排除、不估算
 *   4. 匹配     — 任何额度下推荐都不超支；「点两份」只在放得下时出现
 *   5. 输出     — 账单字段与顺序符合规范
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEVELS, resolveLevel, calorieMaxOf, pointsToNextLevel } from '../src/levels.js';
import { scoreEffort, WEIGHTS } from '../src/effort-scorer.js';
import {
  buildDemoCommits,
  parseGitLog,
  parseProvidedStats,
  commitsFromStats,
  DEMO_SCENARIO_IDS,
} from '../src/git-analyzer.js';
import { loadCaptures, buildCatalog, resolveKcal, buildNutritionIndex } from '../src/catalog.js';
import { matchHealingMeal, formatComponents, formatDiscount } from '../src/meal-matcher.js';
import { renderInvoice, renderExtras } from '../src/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = path.join(__dirname, '..', 'data', 'live');

/** 全流程共用一份目录快照，避免每个用例都读盘 */
const captures = await loadCaptures(LIVE_DIR);
const catalog = buildCatalog(captures);

const kmax = (score) => calorieMaxOf(resolveLevel(score), { unlimited: false });

/* ================================================================== */
/* 1. 评分                                                             */
/* ================================================================== */

test('评分公式：新增×1.0 + 删除×1.5 + 提交×30', () => {
  assert.deepEqual(WEIGHTS, { added: 1.0, deleted: 1.5, commit: 30 });

  const date = new Date('2026-10-15T14:00:00'); // 周四下午，无任何加成
  const effort = scoreEffort([
    { hash: 'a', message: 'feat: 一', insertions: 100, deletions: 0, files: ['a.js'], date },
    { hash: 'b', message: 'feat: 二', insertions: 0, deletions: 40, files: ['b.js'], date },
  ]);

  assert.equal(effort.lines.added, 100);
  assert.equal(effort.lines.deleted, 40);
  assert.equal(effort.commitCount, 2);
  // 100×1.0 + 40×1.5 + 2×30 = 220
  assert.equal(effort.score, 220);
});

test('删除一行比新增一行更值钱（重构 > 堆码）', () => {
  const date = new Date('2026-10-15T14:00:00');
  const add = scoreEffort([{ hash: 'a', message: 'x', insertions: 100, deletions: 0, files: [], date }]);
  const del = scoreEffort([{ hash: 'b', message: 'x', insertions: 0, deletions: 100, files: [], date }]);
  assert.ok(del.score > add.score);
  assert.equal(del.score - add.score, 50); // 100 × (1.5 - 1.0)
});

test('两次提交不足以进入 L2（commit 权重取 30 而非 50 的理由）', () => {
  // 2 × 30 = 60 < 100，L1 才是可达的
  assert.equal(kmax(60), 400);
  assert.equal(resolveLevel(60).id, 'L1');
  // 若按规范原文的 50：2 × 50 = 100，L1 实际只剩 0~1 次提交
  assert.equal(resolveLevel(2 * 50).id, 'L2');
});

test('深夜 / 周末 / 热修只进 context，不改变得分', () => {
  const base = { hash: 'a', author: 'x', message: 'feat: 日常提交', insertions: 10, deletions: 0, files: ['a.js'] };

  const workday = scoreEffort([{ ...base, date: new Date('2026-10-15T14:00:00') }]); // 周四下午
  const night = scoreEffort([{ ...base, date: new Date('2026-10-15T23:30:00') }]); // 周四深夜
  const weekend = scoreEffort([{ ...base, date: new Date('2026-10-17T14:00:00') }]); // 周六
  const hotfix = scoreEffort([
    { ...base, message: 'hotfix: 线上账单溢出紧急回滚', date: new Date('2026-10-15T14:00:00') },
  ]);

  assert.equal(night.score, workday.score, '深夜不应计分');
  assert.equal(weekend.score, workday.score, '周末不应计分');
  assert.equal(hotfix.score, workday.score, '热修不应计分');

  assert.equal(night.context.nightCommits, 1);
  assert.equal(weekend.context.weekendCommits, 1);
  assert.equal(hotfix.context.hotfixCommits, 1);
  assert.equal(workday.context.nightCommits, 0);
});

test('空提交列表得 0 分，落在 L1 而不是崩', () => {
  const effort = scoreEffort([]);
  assert.equal(effort.score, 0);
  assert.equal(resolveLevel(effort.score).id, 'L1');
});

/* ================================================================== */
/* 2. 等级与额度                                                       */
/* ================================================================== */

test('等级断点：100 / 500 / 1200，左闭右开', () => {
  assert.equal(resolveLevel(0).id, 'L1');
  assert.equal(resolveLevel(99.9).id, 'L1');
  assert.equal(resolveLevel(100).id, 'L2');
  assert.equal(resolveLevel(499.9).id, 'L2');
  assert.equal(resolveLevel(500).id, 'L3');
  assert.equal(resolveLevel(1199.9).id, 'L3');
  assert.equal(resolveLevel(1200).id, 'L4');
  assert.equal(resolveLevel(99999).id, 'L4');
});

test('四档额度固定为 400 / 700 / 1100 / 2000', () => {
  assert.deepEqual(
    LEVELS.map((l) => l.maxKcal),
    [400, 700, 1100, 2000],
  );
  assert.equal(kmax(0), 400);
  assert.equal(kmax(100), 700);
  assert.equal(kmax(500), 1100);
  assert.equal(kmax(1200), 2000);
});

test('L4 可通过开关切到真正不限热量', () => {
  const l4 = resolveLevel(5000);
  assert.equal(calorieMaxOf(l4, { unlimited: false }), 2000);
  assert.equal(calorieMaxOf(l4, { unlimited: true }), null);
  // 其他档位不受开关影响
  assert.equal(calorieMaxOf(resolveLevel(0), { unlimited: true }), 400);
});

test('距下一档的分数提示', () => {
  assert.equal(pointsToNextLevel(84).next.id, 'L2');
  assert.equal(pointsToNextLevel(84).remaining, 16);
  assert.equal(pointsToNextLevel(360).remaining, 140);
  assert.equal(pointsToNextLevel(1570).next, null);
});

/* ================================================================== */
/* 3. 数据源                                                           */
/* ================================================================== */

test('numstat 解析正确累计增删行并忽略二进制占位', () => {
  const raw = [
    '@@@@HEDGER@@@@abc12345\x1fdev\x1f2026-10-17T10:00:00+08:00\x1ffeat: first',
    '12\t3\tsrc/a.js',
    '-\t-\tassets/logo.png',
    '@@@@HEDGER@@@@def67890\x1fdev\x1f2026-10-17T11:00:00+08:00\x1ffix: second',
    '5\t0\tsrc/b.js',
  ].join('\n');

  const commits = parseGitLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].insertions, 12);
  assert.equal(commits[0].deletions, 3);
  assert.equal(commits[0].files.length, 2);
  assert.equal(commits[1].message, 'fix: second');
});

test('能解析用户贴进来的 git 统计文本', () => {
  const shortstat = ` 3 files changed, 120 insertions(+), 45 deletions(-)`;
  const a = parseProvidedStats(shortstat);
  assert.deepEqual([a.added, a.deleted], [120, 45]);
  assert.equal(a.matched, true);

  const blocked = [
    'commit a3f91c02aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ' 2 files changed, 40 insertions(+)',
    'commit b7d0e111bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ' 1 file changed, 8 insertions(+), 6 deletions(-)',
  ].join('\n');
  const b = parseProvidedStats(blocked);
  assert.equal(b.commits, 2, '按 commit 行计数');
  assert.deepEqual([b.added, b.deleted], [48, 6], '多条 shortstat 应累加');

  const c = parseProvidedStats('共 5 次提交');
  assert.equal(c.commits, 5);
  assert.equal(c.matched, true);

  assert.equal(parseProvidedStats('今天天气不错').matched, false);
});

test('commitsFromStats 分摊后合计不丢行数', () => {
  const commits = commitsFromStats({ added: 100, deleted: 10, commits: 3 });
  assert.equal(commits.length, 3);
  const added = commits.reduce((s, c) => s + c.insertions, 0);
  const deleted = commits.reduce((s, c) => s + c.deletions, 0);
  assert.equal(added, 100, '尾数必须补回，不能 33×3=99');
  assert.equal(deleted, 10);

  // 分摊结果直接影响得分，合计错了分数就错
  assert.equal(scoreEffort(commits).score, 100 * 1.0 + 10 * 1.5 + 3 * 30);
});

test('真实快照能拼成可核算的商品目录', () => {
  assert.ok(catalog.products.length > 0);
  assert.equal(catalog.storeCode, '1450750');
  assert.match(catalog.storeName, /麦当劳/);

  for (const p of catalog.products) {
    assert.ok(Number.isFinite(p.kcal) && p.kcal > 0, `${p.name} 应有确定热量`);
    assert.ok(p.price >= 0);
  }
  // 每个被排除的商品都必须写明原因，不允许静默估算
  for (const p of catalog.unresolved) {
    assert.ok(p.unresolvedReason, `${p.name} 缺排除原因`);
    assert.equal(p.kcal, null);
  }
});

test('套餐热量 = 默认选配各项之和', () => {
  const combo = catalog.products.find((p) => p.code === '9900005466'); // 巨无霸三件套
  assert.ok(combo, '巨无霸三件套应可核算');
  assert.equal(combo.kind, 'combo');
  // 巨无霸 513 + 中薯条 289 + 可乐中杯 147
  assert.equal(combo.kcal, 513 + 289 + 147);
  assert.equal(combo.components.length, 3);
  assert.equal(combo.price, 36.5);
  assert.equal(combo.originalPrice, 49);
});

test('名字对不上时宁可返回 null，也不猜热量', () => {
  const index = buildNutritionIndex(captures.nutrition);
  assert.equal(resolveKcal('巨无霸', index), 513);
  // 别名：菜单写"新地"，营养表写"朱古力新地"
  assert.equal(resolveKcal('新地', index), resolveKcal('朱古力新地', index));
  // 全角括号/空格/™ 不影响匹配
  assert.equal(resolveKcal('那么大鸡排（椒盐风味）', index), resolveKcal('那么大鸡排', index));
  // 表里没有的就返回 null
  assert.equal(resolveKcal('米其林三星汉堡', index), null);
});

/* ================================================================== */
/* 4. 匹配                                                             */
/* ================================================================== */

test('任何额度下推荐都不超支', () => {
  for (const cap of [1, 100, 250, 400, 700, 1100, 2000, 5000]) {
    const meal = matchHealingMeal(catalog.products, cap);
    if (meal.primary) {
      assert.ok(meal.primary.kcal <= cap, `cap=${cap} 时推荐 ${meal.primary.kcal} kcal 超支`);
    }
    for (const alt of meal.alternates) {
      assert.ok(alt.kcal <= cap, `cap=${cap} 的备选 ${alt.name} 超支`);
    }
  }
});

test('额度小到没有合规项时返回空方案而不是崩', () => {
  const meal = matchHealingMeal(catalog.products, 1);
  assert.equal(meal.primary, null);
  assert.deepEqual(meal.alternates, []);
  const bill = renderInvoice({
    effort: scoreEffort([]),
    level: resolveLevel(0),
    calorieMax: 1,
    meal,
  });
  assert.match(bill, /暂无合规套餐/);
});

test('「点两份」只在放得下时出现，且折扣率不变', () => {
  // 巨无霸三件套单份 949 kcal，两份 1898 > 1100，L3 不该出现
  const l3 = matchHealingMeal(catalog.products, 1100);
  assert.equal(l3.stats.doubles, 0, 'L3 装不下双份');
  assert.ok(!l3.primary.portions);

  // L4 的 2000 额度单份用不满，应当用上双份
  const l4 = matchHealingMeal(catalog.products, 2000);
  assert.ok(l4.stats.doubles > 0, 'L4 应有双份候选');
  assert.ok(l4.primary.metrics.utilization >= 0.8, `L4 额度利用率仅 ${l4.primary.metrics.utilization}`);

  const single = catalog.products.find((p) => p.code === l4.primary.baseCode);
  assert.equal(l4.primary.kcal, single.kcal * l4.primary.portions);
  assert.equal(l4.primary.price, Math.round(single.price * l4.primary.portions * 100) / 100);
  assert.equal(l4.primary.discountRate, single.discountRate, '双份不应改变折扣力度');
});

test('maxPortions=1 可关闭双份，结论回到单份', () => {
  const meal = matchHealingMeal(catalog.products, 2000, { maxPortions: 1 });
  assert.equal(meal.stats.doubles, 0);
  assert.ok(!meal.primary.portions || meal.primary.portions === 1);
});

test('四档推荐互不重复', () => {
  const names = [84, 360, 860, 1570].map((score) => {
    const level = resolveLevel(score);
    const meal = matchHealingMeal(catalog.products, calorieMaxOf(level), { referenceKcal: level.maxKcal });
    assert.ok(meal.primary, `${level.id} 应有推荐`);
    return meal.primary.name;
  });
  assert.equal(new Set(names).size, names.length, `四档推荐重复：${names.join(' / ')}`);
});

test('四档演示场景分别落在对应等级且额度匹配', () => {
  const expected = { l1: [84, 'L1', 400], l2: [360, 'L2', 700], l3: [860, 'L3', 1100], l4: [1570, 'L4', 2000] };
  for (const id of DEMO_SCENARIO_IDS) {
    const effort = scoreEffort(buildDemoCommits(id));
    const [score, levelId, cap] = expected[id];
    assert.equal(effort.score, score, `${id} 得分`);
    assert.equal(resolveLevel(effort.score).id, levelId, `${id} 等级`);
    assert.equal(calorieMaxOf(resolveLevel(effort.score)), cap, `${id} 额度`);
  }
});

/* ================================================================== */
/* 5. 输出                                                             */
/* ================================================================== */

test('展示串：多份写成 (A + B) × 2', () => {
  assert.equal(formatComponents({ name: '单', components: null }), '单');
  assert.equal(
    formatComponents({
      name: '麦辣鸡腿汉堡三件套 ×2',
      portions: 2,
      components: [
        { name: '麦辣鸡腿汉堡', qty: 2, kcal: 970 },
        { name: '中薯条', qty: 2, kcal: 578 },
      ],
    }),
    '（麦辣鸡腿汉堡 + 中薯条）× 2',
  );
  assert.equal(
    formatDiscount({ price: 33.5, originalPrice: 46, saved: 12.5, discountRate: 0.2717 }),
    '¥33.5（原价 ¥46.0，省 ¥12.5，约 27.2% off）',
  );
  assert.equal(formatDiscount({ price: 14, originalPrice: 14, saved: 0, discountRate: 0 }), '¥14.0（无优惠）');
});

test('账单包含规范要求的全部字段，且顺序不变', () => {
  const effort = scoreEffort(buildDemoCommits('l3'));
  const level = resolveLevel(effort.score);
  const calorieMax = calorieMaxOf(level);
  const meal = matchHealingMeal(catalog.products, calorieMax, { referenceKcal: level.maxKcal });
  const bill = renderInvoice({ effort, level, calorieMax, meal });

  const order = [
    '### 🍔 赛博治愈对冲账单 (Cyber Healing Invoice)',
    '* **今日工作量评估**：L3 破浪攻坚（Hardcore）',
    '* **代码变动详情**：新增 380 行 | 删除 180 行 | 共 7 次提交',
    '* **工作量得分**：860 分',
    '* **建议热量上限**：1100 kcal',
    '#### 💖 麦当劳 MCP 推荐治愈套餐：',
    '- **套餐名称**：',
    '- **包含单品**：',
    '- **预估总热量**：',
    '- **优惠活动/价格**：',
    '- **治愈寄语**：',
  ];

  let cursor = -1;
  for (const needle of order) {
    const at = bill.indexOf(needle);
    assert.ok(at > cursor, `账单缺少或错序：${needle}\n---\n${bill}`);
    cursor = at;
  }
});

test('L4 双份方案的补充说明点明"为什么是两份"', () => {
  const effort = scoreEffort(buildDemoCommits('l4'));
  const level = resolveLevel(effort.score);
  const calorieMax = calorieMaxOf(level);
  const meal = matchHealingMeal(catalog.products, calorieMax, { referenceKcal: level.maxKcal });
  const extras = renderExtras({ effort, level, calorieMax, meal, catalog });

  assert.ok(meal.primary.portions > 1);
  assert.match(extras, /装不满 2000 的额度/);
  assert.match(extras, /双份 \d+ 个/);
  assert.match(extras, /不计入得分/, '深夜/周末/热修要明确说明不计分');
});
