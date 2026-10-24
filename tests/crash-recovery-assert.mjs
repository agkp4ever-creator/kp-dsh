/**
 * 轻量断言：渲染进程崩溃恢复策略与主进程接线（node 直跑，不依赖 Electron 运行时）。
 *
 * 覆盖：
 * ① decideCrashAction：killed/clean-exit/未知原因不重建；常规崩溃重建；
 *    launch-failed/integrity-failure 同原因只重试一次；60s 窗口限流。
 * ② recreateDelayMs：300 → 800 → 1500ms 退避，越界钳制。
 * ③ 旧 shouldRecreateRenderer 行为保持（兼容既有调用与测试）。
 * ④ 主进程接线：unresponsive 宽限、强制崩溃、重建失败重试、E2E 钩子。
 *
 * 运行：node tests/crash-recovery-assert.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function source(relativePath) {
  return readFileSync(join(root, relativePath), 'utf-8');
}

// ---------- 把真源码（TS）转成可 import 的 ESM ----------
const staging = mkdtempSync(join(tmpdir(), 'pomodoro-crash-'));
try {
  const code = stripTypeScriptTypes(
    readFileSync(join(root, 'src', 'shared', 'crashPolicy.ts'), 'utf-8'),
    { mode: 'strip' }
  );
  const target = join(staging, 'crashPolicy.mjs');
  writeFileSync(target, code, 'utf-8');
  const policy = await import(pathToFileURL(target).href);

  console.log('① decideCrashAction：崩溃原因与限流');
  check('crashed 首次 → recreate', policy.decideCrashAction('crashed', 0, 0) === 'recreate');
  check('crashed 第 3 次（窗口内 2 次）→ recreate', policy.decideCrashAction('crashed', 2, 0) === 'recreate');
  check('crashed 达到上限（窗口内 3 次）→ give-up', policy.decideCrashAction('crashed', 3, 0) === 'give-up');
  check('oom → recreate', policy.decideCrashAction('oom', 0, 0) === 'recreate');
  check('abnormal-exit → recreate', policy.decideCrashAction('abnormal-exit', 0, 0) === 'recreate');
  check('killed（用户主动结束）→ ignore', policy.decideCrashAction('killed', 0, 0) === 'ignore');
  check('clean-exit（正常退出）→ ignore', policy.decideCrashAction('clean-exit', 0, 0) === 'ignore');
  check('未知 reason → ignore', policy.decideCrashAction('unknown', 0, 0) === 'ignore');
  check('launch-failed 首次 → recreate-once', policy.decideCrashAction('launch-failed', 0, 0) === 'recreate-once');
  check('launch-failed 同原因第二次 → give-up', policy.decideCrashAction('launch-failed', 0, 1) === 'give-up');
  check('integrity-failure 首次 → recreate-once', policy.decideCrashAction('integrity-failure', 1, 0) === 'recreate-once');
  check('integrity-failure 同原因第二次 → give-up', policy.decideCrashAction('integrity-failure', 1, 1) === 'give-up');
  check('非法崩溃次数 → ignore', policy.decideCrashAction('crashed', Number.NaN, 0) === 'ignore');
  check('负数同原因计数 → ignore', policy.decideCrashAction('crashed', 0, -1) === 'ignore');

  console.log('② recreateDelayMs：退避序列');
  check('第 1 次 → 300ms', policy.recreateDelayMs(0) === 300);
  check('第 2 次 → 800ms', policy.recreateDelayMs(1) === 800);
  check('第 3 次 → 1500ms', policy.recreateDelayMs(2) === 1500);
  check('越界 → 1500ms', policy.recreateDelayMs(99) === 1500);
  check('非法值 → 300ms', policy.recreateDelayMs(Number.NaN) === 300);
  check('退避序列长度 3', policy.RECREATE_BACKOFF_MS.length === 3);

  console.log('③ shouldRecreateRenderer：旧行为保持');
  check('crashed 窗口内 2 次 → 可重建', policy.shouldRecreateRenderer('crashed', 2));
  check('crashed 窗口内 3 次 → 不可重建', !policy.shouldRecreateRenderer('crashed', 3));
  check('killed → 不重建', !policy.shouldRecreateRenderer('killed', 0));
  check('clean-exit → 不重建', !policy.shouldRecreateRenderer('clean-exit', 0));
  check('未知 reason → 不重建', !policy.shouldRecreateRenderer('unknown', 0));
  check('非法计数 → 不重建', !policy.shouldRecreateRenderer('crashed', Number.NaN));
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log('④ 主进程接线：unresponsive / 重建重试 / E2E 钩子');
const constantsTs = source(join('src', 'shared', 'constants.ts'));
check('UNRESPONSIVE_GRACE_MS = 5_000', /UNRESPONSIVE_GRACE_MS = 5_000/.test(constantsTs));

const indexTs = source(join('src', 'main', 'index.ts'));
check('使用 decideCrashAction 决策', /decideCrashAction\(/.test(indexTs));
check('使用 recreateDelayMs 退避', /recreateDelayMs\(/.test(indexTs));
check('不再直接调用 shouldRecreateRenderer', !/shouldRecreateRenderer\(/.test(indexTs));
check('监听 unresponsive', /win\.on\('unresponsive'/.test(indexTs));
check('responsive 时清理宽限定时器', /win\.on\('responsive', clearUnresponsiveTimer\)/.test(indexTs));
check('宽限后强制崩溃渲染进程', /forcefullyCrashRenderer\(/.test(indexTs));
check('重建失败后 800ms 重试', /CRASH recreate retry scheduled in 800ms/.test(indexTs) && /recreateAttempt/.test(indexTs));
check('二次失败保留手动恢复提示', /界面无法恢复，请退出后重新打开/.test(indexTs));
check('限流放弃提示托盘重启', /界面已停止，请右键托盘选择「重启界面」/.test(indexTs));
check('E2E 失败注入开关', /POMODORO_E2E_FAIL_RECREATE/.test(indexTs));
check('E2E 手动重启钩子', /__pomodoroRestartRenderer/.test(indexTs));
check('主进程未捕获异常兜底', /process\.on\('uncaughtException'/.test(indexTs));
check('主进程未处理 rejection 兜底', /process\.on\('unhandledRejection'/.test(indexTs));

if (failed > 0) {
  console.error(`\n${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n全部断言通过');
