/**
 * preview 断言套件执行器（QA 脚手架）：生成 preview-under-test.html →
 * Edge headless 跑 → 解析 QA_RESULTS 段 → 汇总 exit code。
 *
 * 之所以单独抽出来：build-preview-test.mjs 只负责注入驱动，
 * 真正执行需要 Edge --headless=new --dump-dom，便于 CI 复跑与自动判红。
 *
 * 运行：node tests/run-preview-suite.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, 'preview-under-test.html');

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error('找不到 Edge（可用 EDGE_PATH 指定）');
  process.exit(2);
}

const build = spawnSync(process.execPath, [join(here, 'build-preview-test.mjs')], {
  encoding: 'utf-8',
});
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  console.error('生成 preview-under-test.html 失败');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'pomodoro-edge-'));
const dom = spawnSync(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=10000',
    '--window-size=1280,1000',
    '--dump-dom',
    `file:///${pagePath.replace(/\\/g, '/')}`,
  ],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
);
rmSync(profile, { recursive: true, force: true });

const html = dom.stdout ?? '';
/* 页面里有两处 QA_RESULTS_BEGIN：驱动脚本源码 + <pre id="qa-results"> 结果块，
   只解析后者，避免把脚本字面量当结果 */
const preMatch = html.match(/<pre id="qa-results"[^>]*>([\s\S]*?)<\/pre>/);
const resultBlock = (preMatch ? preMatch[1] : '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const summary = resultBlock.match(/QA_RESULTS_BEGIN total=(\d+) passed=(\d+) failed=(\d+)/);
if (!summary) {
  writeFileSync(join(here, 'preview-qa-dom.txt'), html, 'utf-8');
  console.error('未找到 QA_RESULTS 结果块（页面脚本可能提前抛错），DOM 已存 tests/preview-qa-dom.txt');
  process.exit(2);
}
writeFileSync(join(here, 'preview-qa-dom.txt'), html, 'utf-8');

const [, total, passed, failed] = summary;
const lines = resultBlock
  .split('\n')
  .filter((line) => /^(PASS|FAIL) \| /.test(line))
  .map((line) => line.split(' | ').map((cell) => cell.trim()));
for (const [state, name, detail] of lines) {
  if (state === 'FAIL') {
    console.log(`  [FAIL] ${name} — ${detail}`);
  }
}
const dockCount = lines.filter((l) => l[1].includes('P1-7')).length;
console.log(`total=${total} passed=${passed} failed=${failed}（其中 P1-7 收纳 ${dockCount} 项）`);
if (Number(failed) > 0) {
  process.exit(1);
}
console.log('preview 断言套件全部通过');
