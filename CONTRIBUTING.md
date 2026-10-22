# 参与贡献

欢迎 issue 与 PR。这个项目刻意保持零依赖、小体积，改动前请先读 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 的分层约定。

## 环境

- Node.js ≥ 18.17（推荐 22，见 `.nvmrc`）
- 不需要 `npm install`

```bash
npm run verify   # 自检 + 单元测试，提交前必须通过
npm run check    # 只跑自检：语法 / JSON / 文档链接 / 包元数据
npm test         # 只跑 24 个单元测试
npm run test:coverage
```

## 目录约定

| 目录 | 放什么 | 不放什么 |
| --- | --- | --- |
| `src/` | 领域逻辑与数据接入 | 参数解析、`console.log`、文件写入 |
| `index.js` | 编排、I/O、导出 | 业务规则 |
| `data/live/` | 带 `capturedAt` 与 `traceId` 的快照 | 任何凭据、个人数据 |
| `test/` | 按行为组织的用例 | 依赖真实网络的用例 |
| `docs/` | 架构、算法、数据说明 | 临时笔记 |

## 代码风格

- **零第三方依赖**。新增运行时依赖需要在 PR 中说明为什么标准库不够。
- **领域层保持纯函数**：`effort-scorer`、`levels`、`meal-matcher`、`report` 不读文件、不发请求、不打印。
- **注释解释 why，不解释 what**。例如为什么提交权重是 30、为什么查不到热量要返回 `null`。
- 命名用英文，面向用户的文案用中文。
- 不引入格式化工具，但请保持与现有文件一致的 2 空格缩进与单引号。

## 修改数值参数

评分权重、等级阈值、匹配权重都会直接改变账单结论，属于**高影响变更**：

1. 同步更新 `test/hedger.test.js` 中对应的断言；
2. 同步更新 `docs/ALGORITHM.md` 的标定表与敏感性实验；
3. 在 PR 描述中贴出四档演示的前后对比（`node index.js --demo all --no-extras`）；
4. 若结论变化会影响 README 中的实测表格，一并更新。

## 提交信息

采用 Conventional Commits：

```
feat(matcher): 支持同款套餐点三份
fix(catalog): 修复别名表未覆盖的新地口味
docs(algo): 补充匹配权重敏感性实验
test: 覆盖 L4 无限额度的边界
chore(ci): 增加 Node 18 矩阵
```

## 更新快照

`data/live/` 是真实调用的结果，不要手改数字。更新流程：

1. 通过 mcd-mcp 重新拉取门店、菜单、营养、套餐成分；
2. 保留 `capturedAt`、`tool`、`traceId` 字段；
3. 在 `workbuddy.md` 追加对应调用记录；
4. 跑 `npm run verify`，确认 24 个测试仍然通过（若因商品下架导致失败，请在 PR 中说明）。

## PR

请使用 PR 模板，至少勾选「`npm run verify` 通过」与「已说明行为影响」。
