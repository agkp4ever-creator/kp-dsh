/**
 * 绿色版自动更新降级 e2e：绿色版没有 resources/app-update.yml，
 * 设置页应显示「绿色版请手动下载新版本覆盖」，且不发起网络检查。
 *
 * 前置：同步 out 到 release/番茄钟挂件-portable/resources/app/out
 * 运行：node tests/e2e/portable-update-smoke.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const portableExe = join(projectRoot, 'release', '番茄钟挂件-portable', '番茄钟挂件.exe');
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-portable-e2e-'));

const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

let app = null;

try {
  app = await electron.launch({ executablePath: portableExe, env, timeout: 30_000 });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.app-shell', { timeout: 15_000 });
  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });

  const status = (await win.locator('.update-status').innerText()).trim();
  assert.match(status, /绿色版请手动下载新版本覆盖/, `绿色版更新提示异常：${status}`);
  assert.equal(
    await win.getByRole('button', { name: '检查更新', exact: true }).isDisabled(),
    false
  );
  console.log(`  ✓ 绿色版更新降级提示：${status}`);

  await win.screenshot({ path: join(projectRoot, 'release', 'portable-update-e2e.png') });
  console.log('  ✓ 截图 release/portable-update-e2e.png');
  console.log('\nPASS portable update e2e：绿色版不检查网络，提示手动更新');
} catch (err) {
  console.error('\nFAIL portable update e2e：', err);
  process.exitCode = 1;
} finally {
  if (app !== null) {
    await app.close().catch(() => undefined);
  }
  rmSync(userDataDir, { recursive: true, force: true });
}
