# 变更日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [1.1.0] - 2026-10-22

工程化与文档现代化，**不改变任何既有行为**：四档演示的推荐、价格、热量与 `1.0.0` 完全一致。

### Added

- `LICENSE`（MIT）
- `docs/ARCHITECTURE.md`：系统上下文、分层与依赖方向、数据契约、8 条设计决策、失败模式
- `docs/ALGORITHM.md`：评分与匹配的形式化定义、参数标定、两组敏感性实验、复杂度与已知局限
- `scripts/check.mjs` 与 `npm run check`：JS 语法、JSON 快照、Markdown 相对链接、包元数据四项自检
- `scripts/experiments.mjs` 与 `npm run experiment`：复现 ALGORITHM.md 中的三张参数敏感性表
- `npm run test:coverage`：`src` 层覆盖率报告
- `npm run verify`：自检 + 单元测试的组合命令
- GitHub Actions：Node 18.20 / 20 / 22 三版本矩阵测试 + 端到端 smoke test + 覆盖率任务
- Issue 模板（Bug / 功能建议）与 PR 模板
- `--version` / `-v` 参数
- `SECURITY.md`、`CONTRIBUTING.md`、`.nvmrc`

### Changed

- `package.json` 补齐 `repository`、`homepage`、`bugs`、`author`、`files` 字段，版本升至 `1.1.0`
- README 重构为评审友好结构：技术摘要前置、补充架构概览与工程质量章节、新增文档索引与局限性说明

## [1.0.0] - 2026-10-17

首个可用版本，参赛提交。

### Added

- 三种数据源：真实 `git log --numstat`、内置四档演示场景、粘贴的统计文本
- 工作量评分 `Score = 新增×1.0 + 删除×1.5 + 提交×30`
- 四档等级（100 / 500 / 1200）与固定热量额度（400 / 700 / 1100 / 2000 kcal）
- 预算约束下的套餐匹配：折扣 0.40 / 性价比 0.35 / 额度利用率 0.25
- 同款套餐 ×2 候选，解决 L4 额度用不满的问题
- 基于 `data/live/` 真实快照的商品目录，名称对不上时排除而非估算
- 账单、补充说明、四档对照表、JSON 导出、Markdown 导出
- MCP 调用记录渲染（`workbuddy.md`）
- 24 个单元测试
