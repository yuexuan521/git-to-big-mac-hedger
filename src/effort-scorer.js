/**
 * 工作量评分（业务规范 v2）
 * ------------------------------------------------------------------
 *   Score = LinesAdded × 1.0 + LinesDeleted × 1.5 + CommitsCount × 30
 *
 * 删除权重 1.5 > 新增 1.0：重构与消灭屎山比堆新代码更费心血。
 * 提交权重取 30（规范建议 50）——50 会让"2 次提交 = 100 分"直接顶到 L2，
 * L1 实际只剩 0~1 次提交，档位几乎不可达；30 的标定过程见 README。
 *
 * 注意：深夜 / 周末 / 热修 / 作战跨度**不参与计分**，
 * 只在 context 里作为"展示口径"输出，用于账单的补充说明。
 */

export const WEIGHTS = {
  added: 1.0,
  deleted: 1.5,
  commit: 30,
};

const NIGHT_START = 22;
const NIGHT_END = 6;
const HOTFIX_PATTERN = /\b(hotfix|hot-fix|revert|rollback|urgent|emergency)\b|紧急|热修|回滚|线上|故障|救火/i;

/**
 * @typedef {object} GitCommit
 * @property {string} hash
 * @property {string} author
 * @property {Date}   date
 * @property {string} message
 * @property {number} insertions
 * @property {number} deletions
 * @property {string[]} files
 */

/**
 * @param {GitCommit[]} commits
 */
export function scoreEffort(commits = []) {
  const list = Array.isArray(commits) ? commits : [];

  let added = 0;
  let deleted = 0;
  const files = new Set();
  let nightCommits = 0;
  let weekendCommits = 0;
  let hotfixCommits = 0;
  let earliest = null;
  let latest = null;

  for (const commit of list) {
    added += commit.insertions ?? 0;
    deleted += commit.deletions ?? 0;

    for (const file of commit.files ?? []) files.add(file);

    const date = commit.date instanceof Date ? commit.date : new Date(commit.date);
    if (Number.isNaN(date.getTime())) continue;

    const hour = date.getHours();
    const day = date.getDay();
    if (hour >= NIGHT_START || hour < NIGHT_END) nightCommits += 1;
    if (day === 0 || day === 6) weekendCommits += 1;
    if (HOTFIX_PATTERN.test(commit.message ?? '')) hotfixCommits += 1;

    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
  }

  const commitCount = list.length;
  const score = added * WEIGHTS.added + deleted * WEIGHTS.deleted + commitCount * WEIGHTS.commit;

  return {
    score: round1(score),
    lines: { added, deleted, total: added + deleted },
    commitCount,
    breakdown: [
      { key: 'added', label: `新增 ${added} 行 × ${WEIGHTS.added}`, points: round1(added * WEIGHTS.added) },
      { key: 'deleted', label: `删除 ${deleted} 行 × ${WEIGHTS.deleted}`, points: round1(deleted * WEIGHTS.deleted) },
      { key: 'commits', label: `提交 ${commitCount} 次 × ${WEIGHTS.commit}`, points: round1(commitCount * WEIGHTS.commit) },
    ],
    /** 不计分的上下文信号，仅用于账单补充说明 */
    context: {
      fileCount: files.size,
      nightCommits,
      weekendCommits,
      hotfixCommits,
      spanHours: earliest && latest ? round1((latest - earliest) / 3_600_000) : 0,
      firstCommitAt: earliest?.toISOString() ?? null,
      lastCommitAt: latest?.toISOString() ?? null,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
