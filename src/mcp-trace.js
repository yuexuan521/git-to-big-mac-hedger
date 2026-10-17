/**
 * MCP 调用记录导出
 * ------------------------------------------------------------------
 * 与旧版的区别：以前客户端自己 spawn 一个 stdio 服务，报文可以逐条抓；
 * 现在 MCP 是宿主注入的原生工具，调用发生在 Agent 侧。
 * 因此这里改为读取 data/live/session.json 里登记的**真实调用**（含 traceId 与返回摘要），
 * 渲染成可对账的 Markdown，而不是伪造一段 JSON-RPC 报文。
 */

/**
 * @param {object} session  data/live/session.json
 * @param {object[]} runs   本轮结算结果
 * @param {object} [catalog]
 * @param {object} [options]
 * @param {string} [options.notes] 人工撰写的前言（data/live/session-notes.md 的内容）
 */
export function renderCallLog(session, runs = [], catalog = null, { notes = '' } = {}) {
  const out = [];
  const calls = session?.calls ?? [];

  out.push('# workbuddy.md — 麦当劳 MCP 调用会话记录');
  out.push('');
  out.push('> 本文件由 `node index.js --record workbuddy.md` 生成。');
  out.push('> 记录内容为本次会话中**真实发生**的 mcd-mcp 工具调用（含服务端返回的 traceId 与服务端时间），');
  out.push('> 返回摘要由程序按真实响应的字段归纳，未虚构数据。');
  out.push('');

  // 人工前言放在第零节，重新生成时由 data/live/session-notes.md 带入，不会被覆盖
  if (notes.trim()) {
    out.push(notes.trim());
    out.push('');
  }

  out.push('## 一、会话环境');
  out.push('');
  out.push('| 项目 | 值 |');
  out.push('| --- | --- |');
  out.push(`| 会话开始 | ${session?.session?.startedAt ?? 'n/a'} |`);
  out.push(`| 客户端 | \`${session?.session?.client ?? 'workbuddy-agent'}\` |`);
  out.push(`| 服务端 | \`${session?.session?.server ?? 'mcd-mcp'}\` |`);
  out.push(`| 传输形态 | ${session?.session?.transport ?? 'mcp (host-native tools)'} |`);
  out.push(`| 调用次数 | ${calls.length} |`);
  out.push(`| 门店 | ${catalog ? `${catalog.storeCode}（${catalog.storeName}）` : 'n/a'} |`);
  out.push('');

  out.push('## 二、调用时序');
  out.push('');
  out.push('```text');
  for (const call of calls) {
    const args = Object.keys(call.arguments ?? {}).length ? JSON.stringify(call.arguments) : '{}';
    out.push(`${String(call.step).padStart(2, '0')}. ${call.tool} ${args}`);
  }
  out.push('```');
  out.push('');

  out.push('## 三、逐条调用记录');
  out.push('');
  for (const call of calls) {
    out.push(`### ${call.step}. \`${call.tool}\``);
    out.push('');
    out.push('| 字段 | 值 |');
    out.push('| --- | --- |');
    out.push(`| 入参 | \`${JSON.stringify(call.arguments ?? {})}\` |`);
    out.push(`| 服务端时间 | ${call.datetime ?? 'n/a'} |`);
    out.push(`| traceId | \`${call.traceId ?? 'n/a'}\` |`);
    out.push('');
    out.push(`**返回摘要**：${call.summary ?? '（未记录）'}`);
    out.push('');
  }

  out.push('## 四、快照与溯源');
  out.push('');
  if (catalog) {
    out.push('| 数据 | 来源工具 | 抓取时间 | traceId |');
    out.push('| --- | --- | --- | --- |');
    const p = catalog.provenance;
    out.push(`| 门店 | query-nearby-stores | ${p.stores?.capturedAt ?? 'n/a'} | ${p.stores?.traceId ?? 'n/a'} |`);
    out.push(`| 菜单 | query-meals | ${p.menu?.capturedAt ?? 'n/a'} | ${p.menu?.traceId ?? 'n/a'} |`);
    out.push(`| 营养 | list-nutrition-foods | ${p.nutrition?.capturedAt ?? 'n/a'} | ${p.nutrition?.traceId ?? 'n/a'} |`);
    out.push(`| 套餐成分 | query-meal-detail | ${p.details?.capturedAt ?? 'n/a'} | 共 ${p.details?.count ?? 0} 个套餐 |`);
    out.push(`| 优惠券 | available-coupons | ${p.coupons?.capturedAt ?? 'n/a'} | 可领 ${p.coupons?.available ?? 0} 张（不含 SKU，仅作展示） |`);
    out.push('');
    out.push(
      `> 商品目录共 ${catalog.products.length} 个可核算热量的商品；${catalog.unresolved.length} 个因成分不在营养表中被排除（不做估算）。`,
    );
  } else {
    out.push('_（未加载目录快照）_');
  }
  out.push('');

  out.push('## 五、本轮结算结果');
  out.push('');
  out.push('| 场景 | 新增/删除/提交 | 得分 | 等级 | 热量上限 | 推荐套餐 | 价格 | 热量 |');
  out.push('| --- | --- | ---: | --- | ---: | --- | ---: | ---: |');
  for (const run of runs) {
    const p = run.meal.primary;
    out.push(
      `| ${run.meta.scenarioLabel} | ${run.effort.lines.added}/${run.effort.lines.deleted}/${run.effort.commitCount} | ${run.effort.score} | ${run.level.id} ${run.level.name} | ${
        run.calorieMax === null ? '不限' : run.calorieMax
      } | ${p ? p.name : '—'} | ${p ? `¥${p.price.toFixed(1)}` : '—'} | ${p ? p.kcal : '—'} |`,
    );
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push(
    '> 本项目为麦当劳程序员节创意开发大赛参赛作品，非麦当劳官方产品；餐品信息、价格与供应状态以麦当劳官方渠道实时结果为准。',
  );

  return out.join('\n');
}
