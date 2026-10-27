/**
 * 紧凑态鼠标穿透 e2e：
 * 1. 普通态不穿透；
 * 2. 紧凑态默认穿透（160×160 / 0.62）；
 * 3. 主进程展开入口恢复 240×240 / 100% 并关闭穿透；
 * 4. 设置页关闭穿透后，紧凑态可点击恢复。
 *
 * 说明：Playwright 的 CDP 点击会绕过 Windows 命中测试，不能证明穿透；
 * 这里用主进程状态钩子断言，真实鼠标穿透另做人工验收。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-click-through-e2e-'));
const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

let app = null;

async function windowState() {
  return app.evaluate(() => globalThis.__pomodoroWindowState?.());
}

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

  const normalState = await windowState();
  assert.equal(normalState?.mode, 'normal', '启动应为 normal');
  assert.equal(normalState?.clickThrough, false, '普通态不应穿透');
  console.log('  ✓ 普通态不穿透');

  await win.getByRole('button', { name: '紧凑模式', exact: true }).click();
  await win.waitForSelector('.app-shell--compact', { timeout: 5_000 });
  await win.waitForTimeout(700);
  const compactState = await windowState();
  assert.equal(compactState?.mode, 'compact', '应为 compact');
  assert.equal(compactState?.clickThrough, true, '紧凑态默认应穿透');
  const compact = await windowInfo();
  assert.equal(compact?.width, 160, `紧凑宽应为 160，实际 ${compact?.width}`);
  assert.equal(compact?.height, 160, `紧凑高应为 160，实际 ${compact?.height}`);
  assert.ok(
    Math.abs((compact?.opacity ?? 0) - 0.62) < 0.02,
    `紧凑透明度应约 0.62，实际 ${compact?.opacity}`
  );
  console.log('  ✓ 紧凑态 160×160 / 0.62，主进程状态为穿透');

  await app.evaluate(() => globalThis.__pomodoroExpandWindow?.());
  await win.waitForSelector('.titlebar', { timeout: 5_000 });
  await win.waitForTimeout(600);
  const expandedState = await windowState();
  assert.equal(expandedState?.mode, 'normal', '展开后应为 normal');
  assert.equal(expandedState?.clickThrough, false, '展开后应关闭穿透');
  const normal = await windowInfo();
  assert.equal(normal?.width, 240, `恢复宽应为 240，实际 ${normal?.width}`);
  assert.equal(normal?.height, 240, `恢复高应为 240，实际 ${normal?.height}`);
  assert.ok(Math.abs((normal?.opacity ?? 0) - 1) < 0.02, '恢复透明度应为 1');
  console.log('  ✓ 主进程展开入口恢复 240×240 / 1.0，并关闭穿透');

  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });
  const toggle = win.getByRole('switch', { name: '紧凑态鼠标穿透', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', '穿透开关默认应开启');
  await toggle.click();
  await win.waitForTimeout(120);
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', '穿透开关应可关闭');
  await win.getByRole('button', { name: '完成', exact: true }).click();
  await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
  console.log('  ✓ 设置页可关闭「紧凑态鼠标穿透」');

  await win.getByRole('button', { name: '紧凑模式', exact: true }).click();
  await win.waitForSelector('.app-shell--compact', { timeout: 5_000 });
  await win.waitForTimeout(700);
  assert.equal((await windowState())?.clickThrough, false, '关闭开关后紧凑态不应穿透');
  await win.locator('.app-shell--compact').click({ position: { x: 80, y: 80 } });
  await win.waitForSelector('.titlebar', { timeout: 5_000 });
  await win.waitForTimeout(600);
  assert.equal((await windowState())?.mode, 'normal', '关闭穿透后点击紧凑窗应恢复');
  console.log('  ✓ 关闭穿透后，点击紧凑窗可恢复普通态');

  console.log('\nPASS e2e compact-click-through：穿透/展开/开关回退全部通过');
}

try {
  await main();
} catch (err) {
  console.error('\nFAIL e2e compact-click-through：', err);
  process.exitCode = 1;
} finally {
  if (app !== null) {
    await app.close().catch(() => undefined);
  }
  rmSync(userDataDir, { recursive: true, force: true });
}
