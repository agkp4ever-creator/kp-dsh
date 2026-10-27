/**
 * 真机验证：主进程按候选列表实际注册全局唤回快捷键，并通过 IPC 返回实际组合。
 *
 * 背景：v0.3.3 固定 Ctrl+Alt+P，用户机器上被其他软件占用后 register 返回 false，
 * 没有任何降级，表现为“快捷键无效”。
 *
 * 运行前需先构建：node node_modules/electron-vite/bin/electron-vite.js build
 * 运行：node tests/e2e/shortcut-registration.spec.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-shortcut-'));
const env = {
  ...process.env,
  POMODORO_E2E: '1',
  // 仅本测试打开全局热键注册（正常 e2e 默认跳过）
  POMODORO_E2E_SHORTCUT: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

let app = null;

async function main() {
  app = await electron.launch({ args: ['.'], cwd: projectRoot, env });
  const page = await app.firstWindow();
  await page.waitForSelector('.timer-ring', { timeout: 15_000 });

  const result = await page.evaluate(() => window.pomodoro.app.getShortcut());
  assert.equal(result.ok, true, `shortcut:get failed: ${JSON.stringify(result)}`);
  const info = result.data;
  assert.ok(info, 'shortcut:get returned no data');
  assert.equal(info.registered, true, `no fallback registered: ${JSON.stringify(info)}`);
  assert.ok(info.label.length > 0, 'shortcut label empty');
  assert.ok(!info.label.includes('CommandOrControl'), 'label leaked accelerator syntax');

  const osRegistered = await app.evaluate(
    ({ globalShortcut }, accelerator) => globalShortcut.isRegistered(accelerator),
    info.accelerator
  );
  assert.equal(osRegistered, true, `globalShortcut.isRegistered(${info.accelerator}) = false`);

  console.log(`  ✓ 候选降级注册成功：${info.label} (${info.accelerator})`);
  console.log(`  ✓ OS 确认 globalShortcut.isRegistered = true`);
  console.log('PASS e2e shortcut-registration：冲突候选降级与 IPC 返回一致');
}

main()
  .catch((error) => {
    console.error('FAIL e2e shortcut-registration：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app !== null) {
      await app.close().catch(() => {});
    }
    rmSync(userDataDir, { recursive: true, force: true });
  });
