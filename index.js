#!/usr/bin/env node
/**
 * Git 提交与巨无霸热量对冲器 — 业务执行引擎
 * ==================================================================
 * 流程（严格按业务规范）：
 *   ① 解析 Git 变动 → 新增行 / 删除行 / 提交次数
 *   ② Score = 新增×1.0 + 删除×1.5 + 提交×30  → 判 L1~L4 → 热量上限
 *   ③ 读 mcd-mcp 快照（菜单 / 营养 / 套餐成分 / 优惠）
 *   ④ 过滤 kcal ≤ CalorieMax，按性价比与折扣力度取最优
 *   ⑤ 输出「赛博治愈对冲账单」
 *
 * 用法：
 *   node index.js                       真实 Git 仓库，最近 24 小时
 *   node index.js --demo all            四档场景全跑
 *   node index.js --input stats.txt     解析用户贴进来的 git 统计
 *   node index.js --demo l4 --out bill.md
 *   node index.js --demo all --record workbuddy.md
 */

import { writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCaptures, buildCatalog } from './src/catalog.js';
import {
  analyzeRepo,
  buildDemoCommits,
  describeScenario,
  isGitRepo,
  parseProvidedStats,
  commitsFromStats,
  DEMO_SCENARIO_IDS,
} from './src/git-analyzer.js';
import { scoreEffort } from './src/effort-scorer.js';
import { resolveLevel, calorieMaxOf, pointsToNextLevel, rangeLabel, LEVELS } from './src/levels.js';
import { matchHealingMeal } from './src/meal-matcher.js';
import { renderInvoice, renderExtras, renderCompact } from './src/report.js';
import { renderCallLog } from './src/mcp-trace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = path.join(__dirname, 'data', 'live');
const pkg = createRequire(import.meta.url)('./package.json');

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    demo: null,
    days: 1,
    store: null,
    unlimited: false,
    double: true,
    input: null,
    json: null,
    out: null,
    record: null,
    extras: true,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i + 1];

    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--unlimited') opts.unlimited = true;
    else if (arg === '--no-double') opts.double = false;
    else if (arg === '--double') opts.double = true;
    else if (arg === '--no-extras') opts.extras = false;
    else if (arg === '--extras') opts.extras = true;
    else if (arg === '--demo') {
      const candidate = next();
      if (candidate && !candidate.startsWith('-')) {
        opts.demo = candidate.toLowerCase();
        i += 1;
      } else {
        opts.demo = 'default';
      }
    } else if (arg.startsWith('--demo=')) {
      opts.demo = arg.split('=')[1].toLowerCase();
    } else if (arg === '--days') {
      opts.days = Math.max(1, Number(next()) || 1);
      i += 1;
    } else if (arg === '--store') {
      opts.store = next();
      i += 1;
    } else if (arg === '--input') {
      opts.input = next();
      i += 1;
    } else if (arg === '--json') {
      const candidate = next();
      if (candidate && !candidate.startsWith('-')) {
        opts.json = candidate;
        i += 1;
      } else {
        opts.json = '-';
      }
    } else if (arg === '--out') {
      opts.out = next();
      i += 1;
    } else if (arg === '--record') {
      opts.record = next();
      i += 1;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Git 提交与巨无霸热量对冲器 · 业务执行引擎

  node index.js [选项]

数据来源（三选一，默认读本地 Git）
  （默认）              读取当前仓库最近 --days 天的提交
  --demo [l1|l2|l3|l4|all]   使用内置四档演示场景
  --input <file|->      解析你贴进来的 git log/diff 统计文本

选项
  --days <n>            统计最近 n 天（默认 1）
  --store <code>        门店编码（快照默认 1450750）
  --unlimited           L4 视为不限热量（默认 2000 kcal）
  --no-double           关闭「同款点两份」候选（L4 单份用不满额度时才会出现）
  --out <file.md>       导出账单到文件
  --record <file.md>    导出 MCP 调用记录
  --json [file]         输出机器可读 JSON（- 表示 stdout）
  --no-extras           只输出账单主体，不带补充说明
  -h, --help            显示帮助
  -v, --version         显示版本

示例
  node index.js --demo l3
  node index.js --demo all --record workbuddy.md
  git log --shortstat -3 | node index.js --input -
`);
}

/* ------------------------------------------------------------------ */
/* 数据准备                                                            */
/* ------------------------------------------------------------------ */

async function collectCommits(opts, scenarioId) {
  if (scenarioId) {
    const commits = buildDemoCommits(scenarioId);
    const scenario = describeScenario(scenarioId);
    return {
      commits,
      label: `demo · ${scenario?.title ?? scenarioId.toUpperCase()}`,
      source: 'demo',
      scenarioId,
    };
  }

  if (opts.input) {
    const text = opts.input === '-' ? await readAllStdin() : await readFile(opts.input, 'utf8');
    const stats = parseProvidedStats(text);
    if (!stats.matched) {
      throw new Error(
        '未能从输入中识别出变更统计。请提供 git log --shortstat / git diff --stat 的原始输出，' +
          '至少包含 "N insertions(+)" 或 "N deletions(-)" 或 "N files changed"。',
      );
    }
    return {
      commits: commitsFromStats(stats),
      label: `input · 新增 ${stats.added} / 删除 ${stats.deleted} / 提交 ${stats.commits}`,
      source: 'input',
      scenarioId: null,
    };
  }

  const now = new Date();
  const since = new Date(now.getTime() - opts.days * 24 * 3600 * 1000);
  const repo = analyzeRepo({ cwd: process.cwd(), since, until: now });
  if (!repo.ok) throw new Error(repo.reason);

  return {
    commits: repo.commits,
    label: `git · ${repo.repoRoot}（最近 ${opts.days} 天）`,
    source: 'git',
    scenarioId: null,
  };
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* 单次结算                                                            */
/* ------------------------------------------------------------------ */

function runSettlement({ commits, label, scenarioId }, catalog, opts) {
  const effort = scoreEffort(commits);
  const level = resolveLevel(effort.score);
  const calorieMax = calorieMaxOf(level, { unlimited: opts.unlimited });

  const meal = matchHealingMeal(catalog.products, calorieMax, {
    referenceKcal: level.maxKcal ?? 2000,
    maxPortions: opts.double === false ? 1 : 2,
  });

  return {
    meta: {
      sourceLabel: label,
      scenarioId,
      scenarioLabel: scenarioId ? scenarioId.toUpperCase() : label.split('·')[0].trim(),
      generatedAt: new Date().toISOString(),
      commitCount: commits.length,
    },
    effort,
    level,
    calorieMax,
    meal,
    next: pointsToNextLevel(effort.score),
    catalog,
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.version) {
    console.log(`${pkg.name} v${pkg.version}`);
    return;
  }

  // 场景列表
  let scenarioIds = [null];
  if (opts.demo) {
    const value = opts.demo === 'default' ? 'l3' : opts.demo;
    if (value === 'all') scenarioIds = [...DEMO_SCENARIO_IDS];
    else if (DEMO_SCENARIO_IDS.includes(value)) scenarioIds = [value];
    else {
      console.error(`未知演示场景 "${value}"，可选：${DEMO_SCENARIO_IDS.join(' / ')} / all`);
      process.exitCode = 2;
      return;
    }
  } else if (!opts.input && !isGitRepo(process.cwd())) {
    console.error('当前目录不是 Git 仓库。可以 git init 后提交，或用 --demo / --input 指定数据。');
    process.exitCode = 2;
    return;
  }

  try {
    // 数据快照 → 统一目录
    const captures = await loadCaptures(LIVE_DIR);
    const catalog = buildCatalog(captures, { storeCode: opts.store ?? undefined });

    const runs = [];
    for (const scenarioId of scenarioIds) {
      const collected = await collectCommits(opts, scenarioId);
      runs.push(runSettlement(collected, catalog, opts));
    }

    // 输出
    if (!opts.json) {
      if (runs.length > 1) {
        console.log('### 四档对照');
        console.log('');
        console.log('| 等级 | 得分 | 增/删/提交 | 上限 | 推荐套餐 | 价格 | 热量 |');
        console.log('| --- | ---: | --- | ---: | --- | ---: | ---: |');
        for (const run of runs) console.log(renderCompact(run));
        console.log('');
      }

      runs.forEach((run, index) => {
        if (index > 0) {
          console.log('');
          console.log('---');
          console.log('');
        }
        console.log(renderInvoice(run));
        if (opts.extras) {
          console.log('');
          console.log('---');
          console.log('');
          console.log(renderExtras(run));
        }
      });
    }

    if (opts.json) {
      const payload = JSON.stringify(
        JSON.parse(
          JSON.stringify(scenarioIds.length === 1 ? runs[0] : runs, (key, value) =>
            key === 'catalog' ? undefined : value,
          ),
        ),
        null,
        2,
      );
      if (opts.json === '-') console.log(payload);
      else {
        await writeFile(opts.json, payload, 'utf8');
        console.error(`[out] JSON → ${opts.json}`);
      }
    }

    if (opts.out) {
      const md = runs
        .map((run) => `${renderInvoice(run)}\n\n---\n\n${renderExtras(run)}`)
        .join('\n\n---\n\n');
      await writeFile(opts.out, md, 'utf8');
      console.error(`[out] 账单 → ${opts.out}`);
    }

    if (opts.record) {
      const session = JSON.parse(await readFile(path.join(LIVE_DIR, 'session.json'), 'utf8'));
      const notes = await readFile(path.join(LIVE_DIR, 'session-notes.md'), 'utf8').catch(() => '');
      const md = renderCallLog(session, runs, catalog, { notes });
      await writeFile(opts.record, md, 'utf8');
      console.error(`[out] MCP 调用记录 → ${opts.record}（${session.calls.length} 条）`);
    }
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    process.exitCode = 1;
  }
}

// 供测试直接引用等级表
export { LEVELS, rangeLabel };

main();
