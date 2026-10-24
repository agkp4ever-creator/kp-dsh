/**
 * 轻量断言：计时结算与设置同步口径（不依赖 Electron 运行时，node 直跑）。
 *
 * 覆盖：
 * ① 跳过按实际已专注时长结算（elapsedMsOf）
 * ② 空闲/暂停态改时长立即生效（reconcilePhaseTime）
 * ③ 系统时钟回拨检测与重锚（fixClockRollback）
 * ④ 自然到点前 remaining 归零（静态约束，保证满额结算）
 * ⑤ 单实例锁、多显示器位置恢复、收纳动画守卫、勿扰状态通道（静态约束）
 * ⑥ 托盘「重启界面」与崩溃限流手动恢复（静态约束）
 *
 * 运行：node tests/timer-settlement-assert.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60_000;

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------- 冻结时间，避免边界抖动 ----------
const realNow = Date.now;
Date.now = () => 1_700_000_000_000;

// ---------- 把真源码（TS）转成可 import 的 ESM ----------
const staging = mkdtempSync(join(tmpdir(), 'pomodoro-timer-'));
try {
  const code = stripTypeScriptTypes(
    readFileSync(join(root, 'src', 'shared', 'timerMath.ts'), 'utf-8'),
    { mode: 'strip' }
  );
  const target = join(staging, 'timerMath.mjs');
  writeFileSync(target, code, 'utf-8');
  const M = await import(pathToFileURL(target).href);

  console.log('① elapsedMsOf：已完成时长');
  check('自然到点（remaining=0）计满额', M.elapsedMsOf(25 * MIN, 0) === 25 * MIN);
  check('跳过：25 分钟走了 10 分钟 → 计 10 分钟', M.elapsedMsOf(25 * MIN, 15 * MIN) === 10 * MIN);
  check('刚开始就跳过 → 0', M.elapsedMsOf(25 * MIN, 25 * MIN) === 0);
  check('剩余大于总时长时钳制为 0', M.elapsedMsOf(25 * MIN, 30 * MIN) === 0);
  check('非法总时长 → 0', M.elapsedMsOf(0, 0) === 0 && M.elapsedMsOf(Number.NaN, 1) === 0);

  console.log('② reconcilePhaseTime：设置变更后重算阶段时长');
  const idle = M.reconcilePhaseTime('idle', 25 * MIN, 25 * MIN, 50 * MIN);
  check(
    '空闲态 25 → 50 分钟：total/remaining 都变 50',
    idle !== null && idle.totalMs === 50 * MIN && idle.remainingMs === 50 * MIN
  );

  const paused = M.reconcilePhaseTime('paused', 25 * MIN, 15 * MIN, 50 * MIN);
  check(
    '暂停态已走 10 分钟、总时长改 50：剩余 40（保留进度）',
    paused !== null && paused.totalMs === 50 * MIN && paused.remainingMs === 40 * MIN
  );

  const shrink = M.reconcilePhaseTime('paused', 25 * MIN, 15 * MIN, 5 * MIN);
  check(
    '暂停态新时长小于已走时长：剩余钳制为 0',
    shrink !== null && shrink.totalMs === 5 * MIN && shrink.remainingMs === 0
  );

  const same = M.reconcilePhaseTime('idle', 25 * MIN, 25 * MIN, 25 * MIN);
  check(
    '时长未变：返回等值（TimerService 据此跳过重复推送）',
    same !== null && same.totalMs === 25 * MIN && same.remainingMs === 25 * MIN
  );

  check('running 不打断：返回 null', M.reconcilePhaseTime('running', 25 * MIN, 10 * MIN, 50 * MIN) === null);
  check('非法新时长：返回 null', M.reconcilePhaseTime('idle', 25 * MIN, 25 * MIN, 0) === null);

  console.log('③ fixClockRollback：系统时钟回拨');
  const lastNow = 1_700_000_000_000;
  const endsAt = lastNow + 10 * MIN;
  const fixed = M.fixClockRollback(lastNow - 5000, lastNow, 10 * MIN, endsAt);
  check(
    '回拨 5 秒：endsAt 重锚为 now + 回拨前剩余',
    fixed !== null && fixed.endsAt === lastNow - 5000 + 10 * MIN && fixed.remainingMs === 10 * MIN
  );
  check('回拨 5 秒：记录回拨量', fixed !== null && fixed.rolledBackMs === 5000);
  check(
    '回拨 0.5 秒（阈值内，NTP 微调）：不修正',
    M.fixClockRollback(lastNow - 500, lastNow, 10 * MIN, endsAt) === null
  );
  check(
    '时钟前进（休眠/正常走时）：不修正',
    M.fixClockRollback(lastNow + 1000, lastNow, 10 * MIN, endsAt) === null
  );
  check(
    '缺少任一快照：不修正',
    M.fixClockRollback(lastNow, null, 10 * MIN, endsAt) === null &&
      M.fixClockRollback(lastNow, lastNow, null, endsAt) === null &&
      M.fixClockRollback(lastNow, lastNow, 10 * MIN, null) === null
  );
  check('非法时间参数：不修正', M.fixClockRollback(Number.NaN, lastNow, 10 * MIN, endsAt) === null);
} finally {
  rmSync(staging, { recursive: true, force: true });
  Date.now = realNow;
}

// ---------- 静态约束：关键接线不能被回退 ----------
function source(relative) {
  return readFileSync(join(root, relative), 'utf-8');
}

console.log('④ 状态机与组装层接线');
const timerTs = source(join('src', 'main', 'timer.ts'));
check(
  '自然到点前 remaining 归零（满额结算的前提）',
  /remainingMs <= 0[\s\S]{0,200}remainingMs: 0[\s\S]{0,120}completePhase\(\)/.test(timerTs)
);
check(
  '专注完成按 elapsedMsOf(totalMs, remainingMs) 结算',
  /const focusDurationMs = elapsedMsOf\(this\.state\.totalMs, this\.state\.remainingMs\)/.test(timerTs)
);
check('0 秒跳过不计番茄（统计防虚高）', /focusDurationMs > 0/.test(timerTs));
check('TimerService 暴露 applySettings(): boolean', /applySettings\(\): boolean/.test(timerTs));
check(
  'tick 检测时钟回拨并重锚（fixClockRollback + 快照）',
  /fixClockRollback\(/.test(timerTs) && /this\.lastTickNow = now/.test(timerTs)
);

const indexTs = source(join('src', 'main', 'index.ts'));
check('设置变更调用 timerService.applySettings()', /timerService\?\.applySettings\(\)/.test(indexTs));
check('存在单实例锁 requestSingleInstanceLock()', /app\.requestSingleInstanceLock\(\)/.test(indexTs));
check('second-instance 只唤醒既有窗口', /second-instance[\s\S]{0,260}showInactive\(\)/.test(indexTs));
check('did-finish-load 回推勿扰状态', /DND_STATE/.test(indexTs));
check(
  '崩溃限流放弃后提供手动恢复（restartRenderer 清空预算）',
  /function restartRenderer\(\)/.test(indexTs) && /rendererCrashTimes = \[\]/.test(indexTs)
);
check('限流放弃时提示用户从托盘重启', /界面已停止，请右键托盘选择/.test(indexTs));

const trayTs = source(join('src', 'main', 'tray.ts'));
check(
  '托盘菜单含「重启界面」并注入 restartWindow',
  /重启界面/.test(trayTs) && /restartWindow/.test(trayTs)
);

console.log('⑤ 窗口与勿扰接线');
const windowTs = source(join('src', 'main', 'window.ts'));
check(
  '位置恢复按保存坐标找显示器（getDisplayNearestPoint）',
  /saved !== null[\s\S]{0,200}screen\.getDisplayNearestPoint\(/.test(windowTs)
);
check('dockToEdge 动画期间忽略重复收纳（dockAnimating）', /dockRuntime\.docked \|\| dockAnimating/.test(windowTs));

const dndTs = source(join('src', 'main', 'dnd.ts'));
check('DndService 暴露 getState(): DndState', /getState\(\): DndState/.test(dndTs));
check('自动检测变化才推送（emitChangeIfNeeded）', /emitChangeIfNeeded\(/.test(dndTs));

console.log('⑥ IPC 白名单与文案');
const preloadTs = source(join('src', 'preload', 'index.ts'));
const constantsTs = source(join('src', 'shared', 'constants.ts'));
check('preload 暴露 timer.get（TIMER_GET）', /TIMER_GET/.test(preloadTs));
check('preload 暴露 dnd.get/onChanged（DND_GET/DND_STATE）', /DND_GET/.test(preloadTs) && /DND_STATE/.test(preloadTs));
check('通道常量已收口', /TIMER_GET: 'timer:get'/.test(constantsTs) && /DND_STATE: 'dnd:state'/.test(constantsTs));

const settingsPanelTs = source(join('src', 'renderer', 'src', 'components', 'SettingsPanel.tsx'));
check(
  '长休文案跟随 longBreakEvery（不再写死 4）',
  /label=\{`\$\{settings\.longBreakEvery\} 个番茄后长休`\}/.test(settingsPanelTs)
);

if (failed > 0) {
  console.error(`\n${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n全部断言通过');
