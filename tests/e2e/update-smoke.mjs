/**
 * 安装版自动更新 e2e（Playwright _electron）：
 * 启动 release/win-unpacked 的打包版 → 打开设置 → 检查更新（本地 HTTP 源）：
 *   1) latest.yml 版本 = 当前 0.2.0 → 显示「已是最新版本」
 *   2) latest.yml 版本改成 0.2.1 → 显示「发现新版本 v0.2.1」
 * 不下载、不安装，避免改动本机安装目录。
 *
 * 前置：node scripts/release.mjs
 * 运行：node tests/e2e/update-smoke.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const packagedExe = join(projectRoot, 'release', 'win-unpacked', '番茄钟挂件.exe');
const latestPath = join(projectRoot, 'release', 'latest.yml');
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-update-e2e-'));

const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const latestYml = readFileSync(latestPath, 'utf-8');
let phase = 'current';

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname !== '/latest.yml') {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const body =
    phase === 'current'
      ? latestYml
      : latestYml.replace(/^version: .*$/m, 'version: 0.2.1');
  res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
});

let app = null;

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('update server 启动失败');
  }
  const updateUrl = `http://127.0.0.1:${address.port}/`;
  env.UPDATE_URL = updateUrl;
  console.log(`  · 本地更新源 ${updateUrl}`);

  app = await electron.launch({
    executablePath: packagedExe,
    env,
    timeout: 30_000,
  });

  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.app-shell', { timeout: 15_000 });
  console.log('  ✓ 打包版启动');

  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });
  console.log('  ✓ 打开设置页');

  const status = win.locator('.update-status');
  await win.getByRole('button', { name: '检查更新', exact: true }).click();
  await win.waitForFunction(
    () => document.querySelector('.update-status')?.textContent?.includes('已是最新版本') ?? false,
    undefined,
    { timeout: 20_000 }
  );
  assert.match((await status.innerText()).trim(), /已是最新版本/);
  console.log('  ✓ 当前版本检查：已是最新版本');

  phase = 'newer';
  await win.getByRole('button', { name: '检查更新', exact: true }).click();
  await win.waitForFunction(
    () => document.querySelector('.update-status')?.textContent?.includes('发现新版本') ?? false,
    undefined,
    { timeout: 20_000 }
  );
  const available = (await status.innerText()).trim();
  assert.match(available, /发现新版本 v0\.2\.1/, `可用版本文案异常：${available}`);
  console.log(`  ✓ 发现新版本：${available}`);

  await win.screenshot({ path: join(projectRoot, 'release', 'update-e2e.png') });
  console.log('  ✓ 截图 release/update-e2e.png');
}

try {
  await main();
  console.log('\nPASS update e2e：安装版检查更新 / 已是最新 / 发现新版本');
} catch (err) {
  console.error('\nFAIL update e2e：', err);
  if (app !== null) {
    try {
      const win = app.windows()[0];
      if (win !== undefined) {
        await win.screenshot({ path: join(projectRoot, 'release', 'update-e2e-fail.png') });
      }
    } catch {
      /* 忽略截图失败 */
    }
  }
  process.exitCode = 1;
} finally {
  if (app !== null) {
    await app.close().catch(() => undefined);
  }
  await new Promise((resolve) => server.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
}
