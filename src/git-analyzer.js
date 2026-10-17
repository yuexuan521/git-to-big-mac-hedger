/**
 * Git 变更读取器
 * ------------------------------------------------------------------
 * 三种数据源，输出结构统一：
 *   1. analyzeRepo()        —— 真实仓库，走 `git log --numstat`
 *   2. buildDemoCommits()   —— 内置四档场景，离线可跑
 *   3. parseProvidedStats() —— 解析用户直接贴进来的 git status/log/diff 统计
 *
 * 注意：只有「新增行 / 删除行 / 提交次数」参与评分，
 * 文件名只用于展示，不影响得分。
 */

import { execFileSync } from 'node:child_process';

const FIELD_SEP = '\x1f';
const RECORD_MARK = '@@@@HEDGER@@@@';

/* ------------------------------------------------------------------ */
/* 真实仓库                                                            */
/* ------------------------------------------------------------------ */

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      // stderr 静默捕获：失败信息由上层转成友好提示
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

export function isGitRepo(cwd) {
  const out = git(cwd, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  return String(out ?? '').trim() === 'true';
}

export function repoRoot(cwd) {
  return String(git(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true }) ?? cwd).trim();
}

/**
 * 读取时间窗口内的提交
 * @param {object} options
 * @param {string} options.cwd
 * @param {Date}   [options.since]
 * @param {Date}   [options.until]
 * @param {number} [options.limit]
 */
export function analyzeRepo({ cwd = process.cwd(), since, until, limit = 500 } = {}) {
  if (!isGitRepo(cwd)) {
    return {
      source: 'git',
      ok: false,
      reason: '当前目录不是 Git 仓库（可先 git init，或使用 --demo 演示模式）',
      commits: [],
    };
  }

  const args = [
    'log',
    `-n${limit}`,
    '--numstat',
    '--no-renames',
    '-M',
    `--pretty=format:${RECORD_MARK}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`,
  ];
  if (since) args.push(`--since=${since.toISOString()}`);
  if (until) args.push(`--until=${until.toISOString()}`);

  const raw = git(cwd, args, { allowFailure: true });
  if (raw === null) {
    return { source: 'git', ok: false, reason: 'git log 执行失败', commits: [] };
  }

  return { source: 'git', ok: true, repoRoot: repoRoot(cwd), commits: parseGitLog(raw) };
}

export function parseGitLog(raw) {
  const commits = [];
  let current = null;

  for (const line of String(raw).split('\n')) {
    if (line.startsWith(RECORD_MARK)) {
      if (current) commits.push(current);
      const body = line.slice(RECORD_MARK.length);
      const [hash, author, iso, ...rest] = body.split(FIELD_SEP);
      current = {
        hash: (hash ?? '').slice(0, 8),
        author: author ?? 'unknown',
        date: iso ? new Date(iso) : new Date(),
        message: rest.join(FIELD_SEP).trim(),
        insertions: 0,
        deletions: 0,
        files: [],
      };
      continue;
    }

    if (!current || !line.trim()) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const [add, del, ...pathParts] = parts;
    const filePath = pathParts.join('\t');
    current.insertions += add === '-' ? 0 : Number(add) || 0;
    current.deletions += del === '-' ? 0 : Number(del) || 0;
    if (filePath) current.files.push(filePath);
  }

  if (current) commits.push(current);
  return commits;
}

/* ------------------------------------------------------------------ */
/* 用户直接贴进来的统计文本                                             */
/* ------------------------------------------------------------------ */

/**
 * 解析 `git log --shortstat` / `git diff --stat` / `git status -s` 里常见的汇总行。
 * 支持：
 *   "3 files changed, 120 insertions(+), 45 deletions(-)"
 *   "120 insertions(+)"
 *   "45 deletions(-)"
 *   "commit a3f91c02..." 逐行计数
 *   "共 5 次提交" / "5 commits"
 *
 * @returns {{added:number, deleted:number, commits:number, matched:boolean}}
 */
export function parseProvidedStats(text) {
  const src = String(text ?? '');

  const sumAll = (re) => {
    let total = 0;
    let hit = false;
    for (const m of src.matchAll(re)) {
      total += Number(m[1]) || 0;
      hit = true;
    }
    return { total, hit };
  };

  const added = sumAll(/(\d+)\s+insertions?\(\+\)/gi);
  const deleted = sumAll(/(\d+)\s+deletions?\(-\)/gi);

  const shaCount = (src.match(/^\s*commit\s+[0-9a-f]{7,40}/gim) ?? []).length;
  const commitLine = src.match(/(?:共\s*)?(\d+)\s*(?:次提交|commits?)/i);
  const commits = shaCount || (commitLine ? Number(commitLine[1]) : 0);

  const matched = added.hit || deleted.hit || commits > 0;

  return { added: added.total, deleted: deleted.total, commits, matched };
}

/** 把解析出的汇总变成"伪提交"，供下游统一处理 */
export function commitsFromStats({ added, deleted, commits }) {
  const count = Math.max(1, commits);
  // 先取整再补尾数：直接 round(added/count) 会把 100 行摊成 33+33+33=99，
  // 少掉的那 1 行正好可能卡在 L1/L2 的边界上。
  const split = (total) => {
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
  };

  const addedParts = split(added);
  const deletedParts = split(deleted);

  return Array.from({ length: count }, (_, i) => ({
    hash: `stats-${i + 1}`,
    author: 'you@localhost',
    date: new Date(),
    message: '来自用户输入的统计',
    insertions: addedParts[i],
    deletions: deletedParts[i],
    files: [],
    fromStats: true,
  }));
}

/* ------------------------------------------------------------------ */
/* 演示场景（按新公式重新标定）                                          */
/* ------------------------------------------------------------------ */

/**
 * 每个场景固定"今天往前推几天"，保证周末/深夜标记可复现：
 *   l1 / l2 → 周四     l3 → 周五     l4 → 周六
 * 行数是按目标分数反推的，见每个场景的 targetScore。
 */
const SCENARIOS = {
  l1: {
    title: '周四 · 正常下班',
    dayOffset: -2,
    hours: [10, 15],
    targetScore: 84,
    filePool: ['README.md', '.gitignore'],
    commits: [
      { message: 'docs: 补全 README 的快速开始章节', insertions: 14, deletions: 2 },
      { message: 'chore: 收敛 .gitignore 里的构建产物', insertions: 4, deletions: 2 },
    ],
  },
  l2: {
    title: '周四 · 稳步推进',
    dayOffset: -2,
    hours: [9, 11, 14, 17],
    targetScore: 360,
    filePool: ['src/cli.js', 'src/catalog.js', 'src/meal-matcher.js', 'test/hedger.test.js'],
    commits: [
      { message: 'feat(cli): 支持 --days 参数指定统计窗口', insertions: 86, deletions: 4 },
      { message: 'feat: 接入 mcd-mcp 查询门店与菜单', insertions: 52, deletions: 6 },
      { message: 'refactor: 把热量核算抽成独立模块', insertions: 28, deletions: 24 },
      { message: 'test: 补齐等级判定的边界用例', insertions: 14, deletions: 6 },
    ],
  },
  l3: {
    title: '周五 · 攻坚 + 加班',
    dayOffset: -1,
    hours: [11, 13, 15, 18, 20, 22, 23],
    targetScore: 860,
    filePool: [
      'src/effort-scorer.js',
      'src/catalog.js',
      'src/meal-matcher.js',
      'src/report.js',
      'test/hedger.test.js',
      'docs/MCP_INTEGRATION.md',
      'index.js',
    ],
    commits: [
      { message: 'feat: 重写工作量评分公式', insertions: 96, deletions: 8 },
      { message: 'feat: 套餐成分拆解与热量累加', insertions: 64, deletions: 6 },
      { message: 'fix: 修复同名商品匹配到错误热量的问题', insertions: 28, deletions: 42 },
      { message: 'refactor: 匹配器改为折扣优先', insertions: 52, deletions: 64 },
      { message: 'feat: 账单输出与治愈寄语', insertions: 44, deletions: 18 },
      { message: 'test: 覆盖 L1~L4 四档快照', insertions: 58, deletions: 26 },
      { message: 'docs: 更新 MCP 集成说明', insertions: 38, deletions: 16 },
    ],
  },
  l4: {
    title: '周六 · 线上救火通宵',
    dayOffset: 0,
    hours: [9, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 22, 23],
    targetScore: 1570,
    filePool: [
      'src/settlement/engine.js',
      'src/settlement/money.js',
      'src/settlement/reconcile.js',
      'src/settlement/idempotent.js',
      'src/alerting/breaker.js',
      'src/jobs/retry-queue.js',
      'src/db/migrations/0042_money_fixed.sql',
      'test/settlement/engine.spec.js',
      'docs/postmortem-2026-10-17.md',
      'deploy/prod.yaml',
    ],
    commits: [
      { message: 'hotfix: 线上账单金额溢出，紧急回滚上一版本', insertions: 12, deletions: 48 },
      { message: 'fix: 定位溢出根因为浮点累加顺序', insertions: 66, deletions: 14 },
      { message: 'hotfix: 补丁上线，灰度 5% 观察', insertions: 24, deletions: 6 },
      { message: 'feat: 重写结算引擎为定点数', insertions: 118, deletions: 46 },
      { message: 'feat: 新增对账任务与补偿队列', insertions: 86, deletions: 42 },
      { message: 'test: 补齐结算回归用例 128 条', insertions: 102, deletions: 18 },
      { message: 'refactor: 抽离幂等层', insertions: 64, deletions: 28 },
      { message: 'feat: 接入告警与自动熔断', insertions: 48, deletions: 26 },
      { message: 'fix: 修复补偿任务重复投递', insertions: 42, deletions: 38 },
      { message: 'feat: 后台新增对账差异看板', insertions: 56, deletions: 12 },
      { message: 'docs: 补写故障复盘', insertions: 38, deletions: 2 },
      { message: 'perf: 批量写入改为 pipeline', insertions: 32, deletions: 36 },
      { message: 'chore: 升级依赖并修复类型告警', insertions: 12, deletions: 4 },
    ],
  },
};

export const DEMO_SCENARIO_IDS = Object.keys(SCENARIOS);

export function describeScenario(id) {
  const s = SCENARIOS[id];
  if (!s) return null;
  const added = s.commits.reduce((sum, c) => sum + c.insertions, 0);
  const deleted = s.commits.reduce((sum, c) => sum + c.deletions, 0);
  return {
    id,
    title: s.title,
    commits: s.commits.length,
    added,
    deleted,
    targetScore: s.targetScore,
  };
}

/**
 * 生成演示提交列表
 * @param {'l1'|'l2'|'l3'|'l4'} id
 * @param {Date} [now]
 */
export function buildDemoCommits(id = 'l3', now = new Date()) {
  const scenario = SCENARIOS[String(id).toLowerCase()];
  if (!scenario) {
    throw new Error(`未知演示场景: ${id}（可选 ${DEMO_SCENARIO_IDS.join(' / ')}）`);
  }

  const base = new Date(now);
  base.setDate(base.getDate() + scenario.dayOffset);

  let cursor = 0;
  return scenario.commits.map((c, index) => {
    const date = new Date(base);
    const hour = scenario.hours[index] ?? scenario.hours[scenario.hours.length - 1] ?? 10;
    date.setHours(hour, (index * 17) % 60, 0, 0);

    const files = [scenario.filePool[cursor % scenario.filePool.length]];
    cursor += 1;

    return {
      hash: hashOf(`${id}-${index}-${c.message}`),
      author: 'you@localhost',
      date,
      message: c.message,
      insertions: c.insertions,
      deletions: c.deletions,
      files,
      demo: true,
    };
  });
}

function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export { SCENARIOS };
