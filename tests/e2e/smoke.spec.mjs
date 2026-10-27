/**
 * Electron 真机 e2e 冒烟（Playwright _electron）：
 * 启动 → 初始 25:00 → 开始/暂停/重置 → 切主题 → 最小化 160×160 + 62% 透明度 → 恢复 240×240
 * → 注入渲染进程崩溃 → 自动重建出新窗口。
 *
 * 运行前需先构建：node node_modules/electron-vite/bin/electron-vite.js build
 * 运行：node tests/e2e/smoke.spec.mjs
 *
 * 使用 POMODORO_USER_DATA_DIR 指向临时目录，避免污染真实设置；
 * POMODORO_E2E=1 让主进程跳过开机自启与勿扰 PowerShell 探测。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-e2e-'));
const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
// 本机 shell 曾把 Electron 以 Node 模式启动：必须清掉，否则不会创建窗口
delete env.ELECTRON_RUN_AS_NODE;

let app = null;

async function windowInfo() {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win === undefined) {
      return null;
    }
    return {
      width: win.getBounds().width,
      height: win.getBounds().height,
      opacity: win.getOpacity(),
    };
  });
}

async function main() {
  app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env,
    timeout: 30_000,
  });

  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.timer-ring', { timeout: 15_000 });
  console.log('  ✓ 窗口启动，计时环已渲染');

  const initial = (await win.locator('.timer-ring__time').innerText()).trim();
  assert.match(initial, /^\d{2}:\d{2}$/, `初始时间格式异常：${initial}`);
  console.log(`  ✓ 初始时间 ${initial}`);

  // 开始 → 暂停 → 重置
  await win.getByRole('button', { name: '开始', exact: true }).click();
  await win.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 5_000 });
  // 主进程 1s tick + 渲染层 1s 快照推进，留出一次 tick 与 IPC 的余量
  await win.waitForTimeout(2_300);
  const runningTime = (await win.locator('.timer-ring__time').innerText()).trim();
  assert.notEqual(runningTime, initial, '开始 2.3s 后时间应递减');
  console.log(`  ✓ 开始后时间递减到 ${runningTime}`);

  await win.getByRole('button', { name: '暂停', exact: true }).click();
  await win.getByRole('button', { name: '继续', exact: true }).waitFor({ timeout: 5_000 });
  const pausedTime = (await win.locator('.timer-ring__time').innerText()).trim();
  await win.waitForTimeout(1_300);
  assert.equal(
    (await win.locator('.timer-ring__time').innerText()).trim(),
    pausedTime,
    '暂停后时间应冻结'
  );
  console.log('  ✓ 暂停后时间冻结');

  await win.getByRole('button', { name: '重置', exact: true }).click();
  await win.getByRole('button', { name: '开始', exact: true }).waitFor({ timeout: 5_000 });
  assert.equal(
    (await win.locator('.timer-ring__time').innerText()).trim(),
    initial,
    '重置后应回到初始时间'
  );
  console.log('  ✓ 重置回到初始时间');

  // 设置 → 森林绿主题
  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });
  await win.getByRole('button', { name: '森林绿', exact: true }).click();
  await win.waitForTimeout(150);
  const theme = await win.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(theme, 'forest', `主题应为 forest，实际 ${theme}`);
  await win.getByRole('button', { name: '完成', exact: true }).click();
  await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
  console.log('  ✓ 主题切换为森林绿并持久化到页面');

  // 最小化：160×160 + 62% 透明度
  await win.getByRole('button', { name: '紧凑模式', exact: true }).click();
  await win.waitForSelector('.app-shell--compact', { timeout: 5_000 });
  await win.waitForTimeout(600);
  const compact = await windowInfo();
  assert.notEqual(compact, null, '紧凑态窗口不存在');
  assert.equal(compact.width, 160, `紧凑宽应为 160，实际 ${compact.width}`);
  assert.equal(compact.height, 160, `紧凑高应为 160，实际 ${compact.height}`);
  assert.ok(
    Math.abs(compact.opacity - 0.62) < 0.02,
    `紧凑透明度应约 0.62，实际 ${compact.opacity}`
  );
  console.log(`  ✓ 最小化到 ${compact.width}×${compact.height}，透明度 ${compact.opacity}`);

  // 紧凑态默认鼠标穿透：用主进程状态断言，不能靠 CDP 点击（CDP 会绕过系统命中测试）
  const compactState = await app.evaluate(() => globalThis.__pomodoroWindowState?.());
  assert.equal(compactState?.mode, 'compact', '紧凑态模式应为 compact');
  assert.equal(compactState?.clickThrough, true, '紧凑态默认应开启鼠标穿透');

  // 通过真实展开入口唤回（托盘/快捷键共用同一函数）
  await app.evaluate(() => globalThis.__pomodoroExpandWindow?.());
  await win.waitForSelector('.titlebar', { timeout: 5_000 });
  await win.waitForTimeout(600);
  const normal = await windowInfo();
  assert.notEqual(normal, null, '恢复后窗口不存在');
  assert.equal(normal.width, 240, `恢复宽应为 240，实际 ${normal.width}`);
  assert.equal(normal.height, 240, `恢复高应为 240，实际 ${normal.height}`);
  assert.ok(Math.abs(normal.opacity - 1) < 0.02, `恢复透明度应为 1，实际 ${normal.opacity}`);
  const normalState = await app.evaluate(() => globalThis.__pomodoroWindowState?.());
  assert.equal(normalState?.mode, 'normal', '展开后模式应为 normal');
  assert.equal(normalState?.clickThrough, false, '展开后应关闭鼠标穿透');
  console.log('  ✓ 紧凑态穿透，主进程展开回 240×240、100% 不透明');

  // 崩溃注入：等待主进程自动重建出新窗口
  const nextWindow = app.waitForEvent('window', { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target !== undefined) {
      target.webContents.forcefullyCrashRenderer();
    }
  });
  const rebuilt = await nextWindow;
  await rebuilt.waitForSelector('.timer-ring', { timeout: 20_000 });
  assert.ok(await rebuilt.locator('.timer-ring').isVisible(), '重建窗口应可见');
  console.log('  ✓ 渲染进程崩溃后自动重建出新窗口');

  console.log('\nPASS e2e smoke：启动 / 开始暂停重置 / 主题 / 最小化透明度 / 崩溃重建全部通过');
}

try {
  await main();
} finally {
  if (app !== null) {
    try {
      await app.close();
    } catch {
      // 崩溃重建后的 Playwright 连接可能已失效，忽略关闭异常
    }
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows 上日志句柄可能延迟释放，留给系统临时目录清理
  }
}
