/**
 * Electron 崩溃自愈专项 e2e（Playwright _electron，真实主进程/渲染进程）：
 * ① 计时中崩溃 → 自动重建后计时状态延续；
 * ② 连续崩溃 4 次 → 第 4 次触发限流放弃 → 托盘手动重启恢复；
 * ③ 首次重建失败 → 800ms 重试成功；
 * ④ unresponsive 宽限后强制崩溃 → 自动重建。
 *
 * 运行前需先构建：node node_modules/electron-vite/bin/electron-vite.js build
 * 运行：node tests/e2e/crash-recovery.spec.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

function baseEnv(userDataDir) {
  const env = {
    ...process.env,
    POMODORO_E2E: '1',
    POMODORO_USER_DATA_DIR: userDataDir,
  };
  // 本机 shell 曾把 Electron 以 Node 模式启动：必须清掉，否则不会创建窗口
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function launch(extraEnv = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-crash-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: { ...baseEnv(userDataDir), ...extraEnv },
    timeout: 30_000,
  });
  return { app, userDataDir };
}

async function close(app, userDataDir) {
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch {
    // 崩溃后的连接可能已失效
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows 日志句柄延迟释放，留给系统清理
  }
}

async function crashCurrent(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target !== undefined) {
      target.webContents.forcefullyCrashRenderer();
    }
  });
}

async function nextWindow(app) {
  const win = await app.waitForEvent('window', { timeout: 20_000 });
  await win.waitForSelector('.timer-ring', { timeout: 20_000 });
  return win;
}

async function expectNoNewWindow(app, timeoutMs = 1_500) {
  const appeared = await app
    .waitForEvent('window', { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  return !appeared;
}

async function main() {
  // ---------- ① 计时中崩溃，重建后状态延续 ----------
  {
    const { app, userDataDir } = await launch();
    try {
      const win = await app.firstWindow({ timeout: 30_000 });
      await win.waitForSelector('.timer-ring', { timeout: 15_000 });
      await win.getByRole('button', { name: '开始', exact: true }).click();
      await win.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 5_000 });
      await win.waitForTimeout(1_600);
      const before = (await win.locator('.timer-ring__time').innerText()).trim();

      await crashCurrent(app);
      const rebuilt = await nextWindow(app);
      await rebuilt.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 5_000 });
      const after = (await rebuilt.locator('.timer-ring__time').innerText()).trim();
      assert.notEqual(after, '25:00', `重建后应保留已走时间，实际 ${after}`);
      assert.ok(before !== after || after !== '25:00', '重建后计时不应回到初始值');
      console.log(`  ✓ 计时中崩溃：${before} → ${after}，重建后仍为运行态`);

      // ---------- ② 连续崩溃触发限流，再手动恢复 ----------
      // ① 已用掉 1 次重建配额；再崩溃 2 次，第 4 次应放弃自动重建
      await crashCurrent(app);
      await nextWindow(app);
      await crashCurrent(app);
      await nextWindow(app);
      await crashCurrent(app);
      const gaveUp = await expectNoNewWindow(app);
      assert.ok(gaveUp, '第 4 次崩溃应触发限流，不再自动重建');
      console.log('  ✓ 连续第 4 次崩溃：自动重建已放弃');

      const recovered = app.waitForEvent('window', { timeout: 20_000 });
      await app.evaluate(() => {
        globalThis.__pomodoroRestartRenderer?.();
      });
      const manual = await recovered;
      await manual.waitForSelector('.timer-ring', { timeout: 20_000 });
      assert.ok(await manual.locator('.timer-ring').isVisible(), '手动重启后窗口应可见');
      console.log('  ✓ 托盘手动重启钩子恢复出新窗口');
    } finally {
      await close(app, userDataDir);
    }
  }

  // ---------- ③ 首次重建失败 → 800ms 重试成功 ----------
  {
    const { app, userDataDir } = await launch({ POMODORO_E2E_FAIL_RECREATE: '1' });
    try {
      const win = await app.firstWindow({ timeout: 30_000 });
      await win.waitForSelector('.timer-ring', { timeout: 15_000 });
      await crashCurrent(app);
      const rebuilt = await nextWindow(app);
      assert.ok(await rebuilt.locator('.timer-ring').isVisible(), '重试后窗口应可见');
      console.log('  ✓ 首次重建失败后 800ms 重试成功');
    } finally {
      await close(app, userDataDir);
    }
  }

  // ---------- ④ unresponsive 宽限后强制崩溃并重建 ----------
  {
    const { app, userDataDir } = await launch({
      POMODORO_E2E_UNRESPONSIVE_GRACE_MS: '800',
    });
    try {
      const win = await app.firstWindow({ timeout: 30_000 });
      await win.waitForSelector('.timer-ring', { timeout: 15_000 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.emit('unresponsive');
      });
      const rebuilt = await nextWindow(app);
      assert.ok(await rebuilt.locator('.timer-ring').isVisible(), 'unresponsive 重建后窗口应可见');
      console.log('  ✓ unresponsive 宽限后强制崩溃并自动重建');
    } finally {
      await close(app, userDataDir);
    }
  }

  console.log('\nPASS crash-recovery e2e：状态延续 / 限流放弃与手动恢复 / 重试 / unresponsive 全部通过');
}

await main();
