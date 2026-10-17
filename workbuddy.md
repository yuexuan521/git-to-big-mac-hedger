# workbuddy.md — 麦当劳 MCP 调用会话记录

> 本文件由 `node index.js --record workbuddy.md` 生成。
> 记录内容为本次会话中**真实发生**的 mcd-mcp 工具调用（含服务端返回的 traceId 与服务端时间），
> 返回摘要由程序按真实响应的字段归纳，未虚构数据。

## 零、这次调用是怎么发生的（两阶段接入记录）

本文件记录的是**开发阶段在 WorkBuddy 会话中真实执行的 MCP 调用过程**。整个接入分两个阶段，前一个阶段的失败并没有被抹掉，因为它是后一个阶段的前提。

### 阶段一：MCP 不可用（第一轮开发）

| 步骤 | 动作 | 结果 |
| --- | --- | --- |
| 1 | 检查当前会话已挂载的 MCP 连接器 | 返回「No connectors installed」——环境中未挂载任何连接器，其中不含 `mcd-mcp` |
| 2 | 在连接器市场按「麦当劳 / mcd-mcp / mcdonald」检索 | 返回 10 个可用连接器（通达信、天眼查、Canva、CloudBase 等），**无麦当劳 MCP** |
| 3 | 检查工具注册表是否存在 `mcd_*` 前缀工具 | 无任何 `mcd_*` 工具可调用 |

**当时的处理方式**：如实记录缺口，不伪造返回值。按官方 `mcd-mcp` 的接口形态（stdio 传输、JSON-RPC 2.0、`initialize` / `tools/list` / `tools/call`）实现了一个协议级兼容的本地服务端，配一份**明确标注为示例**的冻结快照，保证业务代码不依赖对端身份。

### 阶段二：MCP 可用（本轮，已替换全部模拟层）

会话环境随后挂载了真实的 `mcd-mcp`，工具以宿主原生形态注入（`mcd-mcp__*`）。于是本轮做了三件事：

1. **删掉模拟层**：`src/mock-mcd-server.js`、`data/menu.json`、`data/promotions.json` 全部移除。业务代码不再有任何 mock 分支。
2. **按真实契约重写数据层**：真实接口的数据是分三处来的——菜单（`query-meals`，需要 `storeCode`）、热量（`list-nutrition-foods`，**只给商品名、没有编码**）、套餐成分（`query-meal-detail`，按 `rounds[].choices[].isDefault=1` 取默认选配）。三者必须靠**商品名**对齐，这是工作量最大的一处改动，落在 `src/catalog.js`。
3. **抓取真实快照落盘**：`data/live/` 下五个文件 + `session.json`，每条都带服务端返回的 `traceId` 与时间，可逐条对账。

> 一个诚实的说明：本项目的结算逻辑是**可离线复现**的，读的是 `data/live/` 里的快照而不是每次实时请求。这样做是为了让评委在没有 MCP 凭据的环境里也能 `node index.js --demo all` 跑出完全一样的结果。快照的抓取时间与 traceId 都写在第「四」节。

### 从模拟切换到真实时踩到的三个坑

| 坑 | 表现 | 处理 |
| --- | --- | --- |
| 菜单接口必须带门店 | 不传 `storeCode` 直接报错，和第一轮设计的「全局菜单」假设不符 | 先用 `query-nearby-stores` 选店（本轮为 `1450750`，上海徐汇宜山路长兴园餐厅，444 m） |
| 热量表没有商品编码 | 无法用 code join，只能按名字匹配；菜单写「新地」，营养表写「朱古力新地」 | 建归一化函数 + 别名表 + **匹配失败返回 `null`**，宁可排除也不估算 |
| 套餐不直接给热量 | 只给成分，需要拆项后逐项查营养表再累加 | `src/catalog.js` 按 `isDefault=1` 拆默认选配，逐项 `resolveKcal` 后求和 |

本轮共 20 个商品因成分不在营养表中被排除（如「Hold不住鸡排堡（椒盐风味）」），账单里会明确写出「不做估算」，而不是给一个看起来合理的数字。

---

## 第零点五、一张图看懂调用链

```text
git log --numstat
      │  新增行 / 删除行 / 提交次数
      ▼
scoreEffort()  ── Score = 新增×1.0 + 删除×1.5 + 提交×30
      │
      ▼
resolveLevel() ── L1 400 / L2 700 / L3 1100 / L4 2000 kcal
      │
      ▼                      ┌──────────────────────────────────┐
matchHealingMeal() ──────────┤ data/live/  (mcd-mcp 真实快照)     │
      │                      │  query-meals        → 价格/折扣   │
      │  硬约束 kcal ≤ 上限    │  list-nutrition-foods → 热量      │
      │  评分 = 0.40 折扣      │  query-meal-detail  → 套餐成分    │
      │       + 0.35 性价比    │  available-coupons  → 可领券      │
      │       + 0.25 利用率    └──────────────────────────────────┘
      ▼
renderInvoice() ── 🍔 赛博治愈对冲账单
```

## 一、会话环境

| 项目 | 值 |
| --- | --- |
| 会话开始 | 2026-10-17T20:25:39+08:00 |
| 客户端 | `workbuddy-agent` |
| 服务端 | `mcd-mcp` |
| 传输形态 | mcp (host-native tools) |
| 调用次数 | 13 |
| 门店 | 1450750（麦当劳上海徐汇宜山路长兴园餐厅） |

## 二、调用时序

```text
01. list-nutrition-foods {}
02. available-coupons {}
03. query-nearby-stores {"city":"上海","keyword":"漕河泾","beType":1,"searchType":2}
04. query-my-coupons {}
05. query-meals {"storeCode":"1450750","orderType":1,"beType":1}
06. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005466"}
07. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900015602"}
08. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900004835"}
09. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005462"}
10. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900011056"}
11. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005456"}
12. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005464"}
13. query-meal-detail {"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005460"}
```

## 三、逐条调用记录

### 1. `list-nutrition-foods`

| 字段 | 值 |
| --- | --- |
| 入参 | `{}` |
| 服务端时间 | 2026-10-17 20:25:39 |
| traceId | `385b79152e676de3a5c2230ec6c4a835` |

**返回摘要**：返回 160 项餐品营养数据（productName / energyKj / energyKcal / protein / fat / carbohydrate / sodium / calcium）。本项目取其中与菜单相关的 41 项。

### 2. `available-coupons`

| 字段 | 值 |
| --- | --- |
| 入参 | `{}` |
| 服务端时间 | 2026-10-17 20:25:48 |
| traceId | `n/a（该工具返回结构化列表，未带 traceId）` |

**返回摘要**：返回 4 张可领取的麦麦省优惠券：巧克力味厚松饼猪柳蛋套餐、免费脆薯饼、人气麦旋风买一送一、9.9 元中杯冰美式。券不含 SKU 与价格，无法直接换算热量。

### 3. `query-nearby-stores`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"city":"上海","keyword":"漕河泾","beType":1,"searchType":2}` |
| 服务端时间 | 2026-10-17 20:25:48 |
| traceId | `9086671a26395325140bcc34e4d64ef1` |

**返回摘要**：返回 5 家门店，最近为 1450750（麦当劳上海徐汇宜山路长兴园餐厅，444 m，营业中）。选定该店作为后续查询门店。

### 4. `query-my-coupons`

| 字段 | 值 |
| --- | --- |
| 入参 | `{}` |
| 服务端时间 | 2026-10-17 20:25:49 |
| traceId | `n/a（该工具返回文本列表，未带 traceId）` |

**返回摘要**：用户卡包为空，返回「暂无可用优惠券」。因此本次不叠加个人券，优惠以菜单价 currentPrice 为准。

### 5. `query-meals`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1}` |
| 服务端时间 | 2026-10-17 20:25:52 |
| traceId | `bff0f0536c1c05825a76a6a38c406e02` |

**返回摘要**：返回 5 个分类下共 49 个餐品（combo 8 / burger / side / drink / dessert），含 name / currentPrice / originalPrice。套餐的划线价与现价差异即折扣来源。

### 6. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005466"}` |
| 服务端时间 | 2026-10-17 20:26:02 |
| traceId | `cd46fd71be9d2ba475e3e51bd159959f` |

**返回摘要**：巨无霸三件套 → 默认选配：巨无霸 ×1 + 中薯条 ×1 + 可乐中杯 ×1。

### 7. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900015602"}` |
| 服务端时间 | 2026-10-17 20:26:26 |
| traceId | `d4c326a8fda210d4edbf68e4fb4f4b4b` |

**返回摘要**：大堡口福三件套 → Hold不住鸡排堡（椒盐风味）×1 + 中薯条 ×1 + 可乐中杯 ×1。该堡不在营养表中，热量无法核算，被排除。

### 8. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900004835"}` |
| 服务端时间 | 2026-10-17 20:26:26 |
| traceId | `a049d4849d998c4aa64cc584b232d2ba` |

**返回摘要**：麦乐鸡经典中套餐 → 麦乐鸡5块 ×1 + 中薯条 ×1 + 可乐中杯 ×1 = 649 kcal。

### 9. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005462"}` |
| 服务端时间 | 2026-10-17 20:26:32 |
| traceId | `3f600611b22b7086fad7ee09d642213d` |

**返回摘要**：板烧鸡腿堡三件套 → 板烧鸡腿堡 ×1 + 中薯条 ×1 + 可乐中杯 ×1 = 827 kcal。

### 10. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900011056"}` |
| 服务端时间 | 2026-10-17 20:26:32 |
| traceId | `d147cbcb504d9c707e98c63c104363f6` |

**返回摘要**：全明星双人分享餐八件套 → 麦辣鸡腿汉堡 + 板烧鸡腿堡 + 麦乐鸡4块 + 麦辣鸡翅2块 + 中薯条×2 + 可乐中杯×2 = 2142 kcal，超出 L4 的 2000 kcal 上限。

### 11. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005456"}` |
| 服务端时间 | n/a |
| traceId | `5129a077857006bff60f5216b6a2b010` |

**返回摘要**：麦辣鸡腿汉堡三件套 → 麦辣鸡腿汉堡 ×1 + 中薯条 ×1 + 可乐中杯 ×1 = 921 kcal。补抓后 L3 首次出现比巨无霸更划算的候选。（服务端时间未单独留存，以 traceId 对账）

### 12. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005464"}` |
| 服务端时间 | n/a |
| traceId | `22f01d7ee4e9fed3dcecad38b824603d` |

**返回摘要**：双层吉士汉堡套餐 → 双层吉士汉堡 ×1 + 中薯条 ×1 + 可乐中杯 ×1 = 865 kcal。（服务端时间未单独留存，以 traceId 对账）

### 13. `query-meal-detail`

| 字段 | 值 |
| --- | --- |
| 入参 | `{"storeCode":"1450750","orderType":1,"beType":1,"code":"9900005460"}` |
| 服务端时间 | 2026-10-17 20:31:15 |
| traceId | `353f8cedbfc117bf06712bc181dffe08` |

**返回摘要**：麦香鱼中套餐 → 麦香鱼 ×1 + 中薯条 ×1 + 可乐中杯 ×1 = 761 kcal。该套餐成为 L2 的「差一点点」提示项（超出 700 额度 61 kcal）。

## 四、快照与溯源

| 数据 | 来源工具 | 抓取时间 | traceId |
| --- | --- | --- | --- |
| 门店 | query-nearby-stores | 2026-10-17T20:25:48+08:00 | 9086671a26395325140bcc34e4d64ef1 |
| 菜单 | query-meals | 2026-10-17T20:25:52+08:00 | bff0f0536c1c05825a76a6a38c406e02 |
| 营养 | list-nutrition-foods | 2026-10-17T20:25:39+08:00 | 385b79152e676de3a5c2230ec6c4a835 |
| 套餐成分 | query-meal-detail | 2026-10-17T20:26:32+08:00 | 共 8 个套餐 |
| 优惠券 | available-coupons | 2026-10-17T20:25:48+08:00 | 可领 4 张（不含 SKU，仅作展示） |

> 商品目录共 29 个可核算热量的商品；20 个因成分不在营养表中被排除（不做估算）。

## 五、本轮结算结果

| 场景 | 新增/删除/提交 | 得分 | 等级 | 热量上限 | 推荐套餐 | 价格 | 热量 |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: |
| L1 | 18/4/2 | 84 | L1 微光轻步 | 400 | 那么大鸡排（椒盐风味） | ¥14.0 | 385 |
| L2 | 180/40/4 | 360 | L2 踏实前行 | 700 | 麦乐鸡经典中套餐 | ¥25.0 | 649 |
| L3 | 380/180/7 | 860 | L3 破浪攻坚 | 1100 | 麦辣鸡腿汉堡三件套 | ¥33.5 | 921 |
| L4 | 700/320/13 | 1570 | L4 拯救世界 | 2000 | 麦辣鸡腿汉堡三件套 ×2 | ¥67.0 | 1842 |

---

> 本项目为麦当劳程序员节创意开发大赛参赛作品，非麦当劳官方产品；餐品信息、价格与供应状态以麦当劳官方渠道实时结果为准。