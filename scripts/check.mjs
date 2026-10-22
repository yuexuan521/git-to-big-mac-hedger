#!/usr/bin/env node
/**
 * 项目自检（零依赖）
 * ------------------------------------------------------------------
 * 在跑测试之前先挡掉一类"低级但致命"的问题：
 *   1. JS 语法错误          —— node --check 逐个文件
 *   2. JSON 快照损坏        —— 无法解析就没法核算热量
 *   3. Markdown 链接失效    —— 文档体系变大后最容易腐烂的地方
 *   4. bin 入口与 package.json 元数据不一致
 *
 * 用法：node scripts/check.mjs
 * 退出码：0 通过 / 1 失败
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'coverage', 'dist', '.github']);
const SKIP_MD = new Set(['CHANGELOG.md']); // 变更日志里的历史链接允许指向已移除文件

const problems = [];
const summary = [];

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

/* 1. JS 语法 ---------------------------------------------------------- */

const jsFiles = walk(ROOT, (name) => name.endsWith('.js') || name.endsWith('.mjs'));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
    problems.push(`语法错误 ${rel(file)}：${detail}`);
  }
}
summary.push(`语法检查 ${jsFiles.length} 个 JS 文件`);

/* 2. JSON 快照 -------------------------------------------------------- */

const jsonFiles = walk(path.join(ROOT, 'data'), (name) => name.endsWith('.json'));
for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`JSON 无法解析 ${rel(file)}：${err.message}`);
  }
}
summary.push(`JSON 解析 ${jsonFiles.length} 份快照`);

/* 3. Markdown 相对链接 ------------------------------------------------ */

const mdFiles = [
  ...walk(ROOT, (name) => name.endsWith('.md')).filter((f) => !SKIP_MD.has(path.basename(f))),
];

let linkCount = 0;
for (const file of mdFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
    const raw = match[1];
    if (/^(https?:|mailto:|tel:|#)/i.test(raw)) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    const decoded = decodeURI(target.replace(/^<|>$/g, ''));
    const resolved = decoded.startsWith('/')
      ? path.join(ROOT, decoded)
      : path.resolve(path.dirname(file), decoded);
    linkCount += 1;
    if (!existsSync(resolved)) {
      problems.push(`链接失效 ${rel(file)} → ${raw}`);
    }
  }
}
summary.push(`文档链接 ${linkCount} 条`);

/* 4. 包元数据 --------------------------------------------------------- */

const pkgPath = path.join(ROOT, 'package.json');
let pkg = null;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  problems.push(`package.json 无法解析：${err.message}`);
}

if (pkg) {
  for (const [name, target] of Object.entries(pkg.bin ?? {})) {
    const binPath = path.join(ROOT, target);
    if (!existsSync(binPath)) problems.push(`package.json bin.${name} 指向不存在的文件：${target}`);
  }
  if (!pkg.license) problems.push('package.json 缺少 license 字段');
  if (!existsSync(path.join(ROOT, 'LICENSE'))) problems.push('缺少 LICENSE 文件');
  summary.push(`包元数据 ${pkg.name}@${pkg.version}`);
}

/* 输出 ---------------------------------------------------------------- */

const ok = problems.length === 0;
console.log('');
console.log(`项目自检 · ${ok ? '通过' : '未通过'}`);
for (const line of summary) console.log(`  · ${line}`);

if (!ok) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  console.log(`共 ${problems.length} 个问题。`);
  process.exitCode = 1;
} else {
  console.log('');
}
