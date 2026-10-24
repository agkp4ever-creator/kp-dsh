/**
 * 轻量断言：第二批性能与健壮性（不依赖 Electron 运行时，node 直跑）。
 *
 * 覆盖：
 * ① 勿扰探测按需降频（nextDndProbeDelayMs）
 * ② 渲染进程崩溃重建限流（shouldRecreateRenderer）
 * ③ 日志轮转阈值（shouldRotateLog）
 * ④ tick 1s + 渲染层 rAF 补间、崩溃监听、CSP、日志轮转接线（静态约束）
 *
 * 运行：node tests/perf-hardening-assert.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function source(relative) {
  return readFileSync(join(root, relative), 'utf-8');
}

/** 把真源码（TS）转成可 import 的 ESM */
async function loadTs(relative, staging) {
  const code = stripTypeScriptTypes(readFileSync(join(root, relative), 'utf-8'), {
    mode: 'strip',
  });
  const target = join(staging, `${relative.replace(/[\\/]/g, '_')}.mjs`);
  writeFileSync(target, code, 'utf-8');
  return import(pathToFileURL(target).href);
}

const staging = mkdtempSync(join(tmpdir(), 'pomodoro-perf-'));
try {
  const dndPolicy = await loadTs(join('src', 'shared', 'dndPolicy.ts'), staging);
  const crashPolicy = await loadTs(join('src', 'shared', 'crashPolicy.ts'), staging);
  const logPolicy = await loadTs(join('src', 'shared', 'logPolicy.ts'), staging);

  console.log('① nextDndProbeDelayMs：勿扰探测按需降频');
  const base = { status: 'running', windowVisible: true, minimized: false, detectionAvailable: true };
  check('运行中 + 可见 → 10s', dndPolicy.nextDndProbeDelayMs(base) === 10_000);
  check(
    '空闲 + 可见 → 60s',
    dndPolicy.nextDndProbeDelayMs({ ...base, status: 'idle' }) === 60_000
  );
  check(
    '暂停 + 可见 → 60s',
    dndPolicy.nextDndProbeDelayMs({ ...base, status: 'paused' }) === 60_000
  );
  check(
    '隐藏 → 120s（优先于运行态）',
    dndPolicy.nextDndProbeDelayMs({ ...base, windowVisible: false }) === 120_000
  );
  check(
    '最小化 → 120s',
    dndPolicy.nextDndProbeDelayMs({ ...base, minimized: true }) === 120_000
  );
  check(
    '自动检测已降级 → 300s（优先于一切）',
    dndPolicy.nextDndProbeDelayMs({ ...base, detectionAvailable: false }) === 300_000
  );

  console.log('② shouldRecreateRenderer：崩溃重建限流');
  check('crashed 且窗口内 0 次 → 重建', crashPolicy.shouldRecreateRenderer('crashed', 0));
  check('oom 且窗口内 2 次 → 重建', crashPolicy.shouldRecreateRenderer('oom', 2));
  check(
    '达到 3 次上限 → 停止重建',
    !crashPolicy.shouldRecreateRenderer('crashed', 3)
  );
  check('killed（用户主动结束）→ 不重建', !crashPolicy.shouldRecreateRenderer('killed', 0));
  check('clean-exit（正常退出）→ 不重建', !crashPolicy.shouldRecreateRenderer('clean-exit', 0));
  check('未知 reason → 不重建', !crashPolicy.shouldRecreateRenderer('unknown', 0));
  check('非法计数 → 不重建', !crashPolicy.shouldRecreateRenderer('crashed', Number.NaN));

  console.log('③ shouldRotateLog：日志按大小轮转');
  check('未达上限 → 不轮转', !logPolicy.shouldRotateLog(MB - 1));
  check('刚好达到上限 → 轮转', logPolicy.shouldRotateLog(logPolicy.LOG_MAX_BYTES));
  check('超过上限 → 轮转', logPolicy.shouldRotateLog(2 * MB));
  check('非法大小 → 不轮转', !logPolicy.shouldRotateLog(Number.NaN) && !logPolicy.shouldRotateLog(0));
  check('Infinity 仍触发轮转（不静默跳过）', logPolicy.shouldRotateLog(Number.POSITIVE_INFINITY));
  check('保留 2 份归档', logPolicy.LOG_KEEP_ARCHIVES === 2);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log('④ tick 1s + 渲染层 rAF 补间');
const constantsTs = source(join('src', 'shared', 'constants.ts'));
check('TICK_INTERVAL_MS = 1000', /TICK_INTERVAL_MS = 1000/.test(constantsTs));
const timerRingTs = source(join('src', 'renderer', 'src', 'components', 'TimerRing.tsx'));
check('TimerRing 接收 endsAt', /endsAt: number/.test(timerRingTs));
check('TimerRing 用 requestAnimationFrame 补间', /requestAnimationFrame\(/.test(timerRingTs));
check('补间不倒退（Math.min(estimate, byWall)）', /Math\.min\(estimate, byWall\)/.test(timerRingTs));
const appTs = source(join('src', 'renderer', 'src', 'App.tsx'));
check('App 两处 TimerRing 都传 endsAt', (appTs.match(/endsAt=\{state\.endsAt\}/g) ?? []).length === 2);

console.log('⑤ 主进程接线：勿扰调度 / 崩溃恢复 / 日志轮转');
const indexTs = source(join('src', 'main', 'index.ts'));
check('使用 dndPolicy 计算探测间隔', /nextDndProbeDelayMs\(/.test(indexTs));
check('存在动态调度 scheduleDndProbe', /function scheduleDndProbe/.test(indexTs));
check('开始计时立即探测一次', /scheduleDndProbe\(0\)/.test(indexTs));
check('监听 render-process-gone', /app\.on\('render-process-gone'/.test(indexTs));
check('监听 child-process-gone', /app\.on\('child-process-gone'/.test(indexTs));
check('崩溃重建走 decideCrashAction 决策', /decideCrashAction\(/.test(indexTs));
check('重建共用 bindWindow（回推状态）', /function bindWindow/.test(indexTs));
check('退出前清理勿扰调度句柄', /dndProbeTimer[\s\S]{0,120}clearTimeout/.test(indexTs));

const dndTs = source(join('src', 'main', 'dnd.ts'));
check('DndService 不再常驻 setInterval', !/setInterval\(/.test(dndTs));
check('DndService 暴露 detectNow()', /async detectNow\(\)/.test(dndTs));
check(
  '降级后仍允许低频重试（不会永久锁死在手动模式）',
  !/!this\.detectionAvailable \|\| this\.detecting/.test(dndTs) && /if \(this\.detecting\)/.test(dndTs)
);

const windowTs = source(join('src', 'main', 'window.ts'));
check('window 暴露 resetDockRuntime', /export function resetDockRuntime/.test(windowTs));

const loggerTs = source(join('src', 'main', 'logger.ts'));
check('logger 使用 shouldRotateLog', /shouldRotateLog\(/.test(loggerTs));
check('logger 存在归档滚动 rotateIfNeeded', /function rotateIfNeeded/.test(loggerTs));

console.log('⑥ 子代理审查修复：DND 刷新 / 崩溃互斥 / 主题兜底');
check(
  '窗口 show/restore 后立即重排探测',
  /win\.on\('show', \(\) => scheduleDndProbe\(0\)\)/.test(indexTs) &&
    /win\.on\('restore', \(\) => scheduleDndProbe\(0\)\)/.test(indexTs)
);
check('隐藏/最小化后按新可见性重排', /win\.on\('hide', \(\) => scheduleDndProbe\(\)\)/.test(indexTs));
check('计时状态变化时重排探测', /state\.status !== lastTimerStatus/.test(indexTs));
check(
  '崩溃配额只在通过限流后计入',
  indexTs.lastIndexOf('shouldRecreateRenderer(') < indexTs.indexOf('rendererCrashTimes.push(now)')
);
check('重建互斥标志', /let recreating = false/.test(indexTs) && /if \(recreating\)/.test(indexTs));
check('window-all-closed 重建期间不误退', /if \(!isQuitting\(\) && !recreating\)/.test(indexTs));
check('sendToRenderer 跳过已崩溃 webContents', /contents\.isCrashed\(\)/.test(indexTs));
check('DND 降级时清空自动勿扰', /this\.editingForeground = false/.test(dndTs));
check('不再用过宽的 /resolve/i 匹配', !/\/resolve\/i/.test(dndTs));
check('TimerRing 对 endsAt=null 不做空转', /endsAt === null/.test(timerRingTs));

const preloadTs = source(join('src', 'preload', 'index.ts'));
check('THEME_GET 通道已定义', /THEME_GET: 'theme:get'/.test(constantsTs));
check('preload 暴露 theme.get', /get: \(\): Promise<IpcResult<ThemeScheme>>/.test(preloadTs));
check('App 订阅后主动拉取主题', /window\.pomodoro\.theme\.get\(\)/.test(appTs));

console.log('⑦ CSP 与构建产物');
const viteConfigTs = source('electron.vite.config.ts');
check('构建配置注入 CSP 插件', /function cspPlugin/.test(viteConfigTs) && /Content-Security-Policy/.test(viteConfigTs));
const builtHtml = join(root, 'out', 'renderer', 'index.html');
if (process.env.CHECK_BUILD_OUTPUT === '1' && existsSync(builtHtml)) {
  const html = readFileSync(builtHtml, 'utf-8');
  check('构建产物 index.html 含 CSP', /http-equiv="Content-Security-Policy"/.test(html));
  check(
    "CSP 禁止 remote/inline 脚本（script-src 'self'）",
    /script-src 'self'/.test(html) && !/script-src[^;]*unsafe-inline/.test(html)
  );
} else {
  console.log('  [SKIP] 构建产物 CSP 检查需 CHECK_BUILD_OUTPUT=1（构建后执行）');
}

if (failed > 0) {
  console.error(`\n${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n全部断言通过');
