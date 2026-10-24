/**
 * 真升级回归（会安装/卸载本机程序，单独运行，不并入 test:e2e）：
 *   1) 静默安装 0.2.0 安装包
 *   2) 启动安装版 0.2.0，改主题/专注时长，检查更新 → 下载 0.2.1 → 重启安装
 *   3) 等待安装完成，启动 0.2.1，验证版本与设置保留
 *   4) 静默卸载并清理临时数据
 *
 * 前置：先打 0.2.1 包（package.json version=0.2.1 + npm run release:win），
 *       且 release/ 下保留 pomodoro-widget-setup-0.2.0.exe 与 0.2.1 产物。
 * 运行：node tests/e2e/real-upgrade.spec.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const releaseDir = join(projectRoot, 'release');
const setup020 = join(releaseDir, 'pomodoro-widget-setup-0.2.0.exe');
const setup021 = join(releaseDir, 'pomodoro-widget-setup-0.2.1.exe');
const latestPath = join(releaseDir, 'latest.yml');
const installDir = join(process.env.LOCALAPPDATA, 'Programs', 'pomodoro_desktop_widget');
const installedExe = join(installDir, '番茄钟挂件.exe');
const uninstaller = join(installDir, 'Uninstall 番茄钟挂件.exe');
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-real-upgrade-'));
const screenshotPath = join(releaseDir, 'real-upgrade-e2e.png');

const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

let server = null;
let app = null;

function log(line) {
  console.log(`  ${line}`);
}

function powershell(script, timeout = 30_000) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf-8',
    timeout,
  }).trim();
}

function productVersion() {
  const escaped = installedExe.replace(/'/g, "''");
  const out = powershell(
    `if (Test-Path '${escaped}') { (Get-Item '${escaped}').VersionInfo.ProductVersion } else { '' }`,
    10_000
  );
  return out;
}

function waitForInstalledVersion(expected, timeoutMs = 120_000) {
  const escaped = installedExe.replace(/'/g, "''");
  const script = [
    `$exe = '${escaped}'`,
    `for ($i = 0; $i -lt ${Math.ceil(timeoutMs / 1000)}; $i++) {`,
    "  try { $v = (Get-Item $exe -ErrorAction Stop).VersionInfo.ProductVersion } catch { $v = '' }",
    `  if ($v -like '${expected}*') { Write-Output $v; exit 0 }`,
    '  Start-Sleep -Seconds 1',
    '}',
    "Write-Output 'timeout'",
    'exit 1',
  ].join('\n');
  const out = powershell(script, timeoutMs + 10_000);
  assert.match(out, new RegExp(`^${expected.replace(/\./g, '\\.')}`), `安装未完成：${out}`);
  return out;
}

function killInstalled() {
  try {
    execFileSync('taskkill', ['/F', '/IM', '番茄钟挂件.exe'], {
      stdio: 'ignore',
      timeout: 15_000,
    });
  } catch {
    /* 没有正在运行的测试实例 */
  }
}

function startStaticServer() {
  const mime = {
    '.yml': 'text/yaml; charset=utf-8',
    '.exe': 'application/octet-stream',
    '.blockmap': 'application/octet-stream',
  };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'latest.yml' : pathname.replace(/^\/+/, '');
    const file = join(releaseDir, relative);
    if (!file.startsWith(releaseDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const size = statSync(file).size;
    const type = mime[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;
    if (range !== undefined) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match === null) {
        res.writeHead(416);
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function install020() {
  const version = productVersion();
  if (version.startsWith('0.2.0')) {
    log(`0.2.0 已安装（${version}），跳过安装`);
    return;
  }
  log('静默安装 0.2.0');
  execFileSync(setup020, ['/S'], { timeout: 120_000 });
  const got = waitForInstalledVersion('0.2.0', 60_000);
  assert.match(got, /^0\.2\.0/);
  log(`0.2.0 安装完成（${got}）`);
}

async function launch(executablePath, timeout = 30_000) {
  return electron.launch({ executablePath, env, timeout });
}

async function openSettings(win) {
  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });
}

async function closeSettings(win) {
  await win.getByRole('button', { name: '完成', exact: true }).click();
  await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
}

async function main() {
  for (const file of [setup020, setup021, latestPath]) {
    assert.ok(existsSync(file), `缺少产物：${file}`);
  }
  const latest = readFileSync(latestPath, 'utf-8');
  assert.match(latest, /^version: 0\.2\.1$/m, 'latest.yml 不是 0.2.1');

  install020();
  killInstalled();

  const port = await startStaticServer();
  env.UPDATE_URL = `http://127.0.0.1:${port}/`;
  log(`本地更新源 ${env.UPDATE_URL}`);

  log('启动 0.2.0');
  app = await launch(installedExe);
  let win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.app-shell', { timeout: 15_000 });

  await openSettings(win);
  await win.getByRole('button', { name: '森林绿', exact: true }).click();
  await win.getByRole('button', { name: '专注时长增加', exact: true }).click();
  await win.getByRole('button', { name: '专注时长增加', exact: true }).click();
  const focus = (await win.locator('.setting-row', { hasText: '专注时长' }).locator('.stepper__value').innerText()).trim();
  assert.equal(focus, '27 分');
  await closeSettings(win);
  log('0.2.0 设置已改为森林绿 / 专注 27 分');

  await openSettings(win);
  const check = win.getByRole('button', { name: '检查更新', exact: true });
  if (await check.isEnabled()) {
    await check.click();
  }
  await win.waitForFunction(
    () => document.querySelector('.update-status')?.textContent?.includes('发现新版本') ?? false,
    undefined,
    { timeout: 30_000 }
  );
  const available = (await win.locator('.update-status').innerText()).trim();
  assert.match(available, /v0\.2\.1/);
  log(`检查更新：${available}`);

  await win.getByRole('button', { name: '下载更新', exact: true }).click();
  await win.waitForFunction(
    () => document.querySelector('.update-status')?.textContent?.includes('已下载') ?? false,
    undefined,
    { timeout: 180_000 }
  );
  log(`下载完成：${(await win.locator('.update-status').innerText()).trim()}`);

  log('点击重启安装');
  try {
    await win.getByRole('button', { name: '重启安装', exact: true }).click();
  } catch {
    /* 点击后应用立即退出，连接可能先断 */
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const upgraded = waitForInstalledVersion('0.2.1', 120_000);
  log(`安装完成（${upgraded}）`);

  killInstalled();
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  log('启动 0.2.1 验证设置保留');
  app = await launch(installedExe);
  win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.app-shell', { timeout: 15_000 });
  await openSettings(win);

  const versionText = (await win.locator('.setting-row', { hasText: '当前版本' }).locator('.setting-row__value').innerText()).trim();
  assert.equal(versionText, 'v0.2.1', `版本未升级：${versionText}`);
  const activeTheme = (await win.locator('.theme-chip--active').innerText()).trim();
  assert.equal(activeTheme, '森林绿', `主题未保留：${activeTheme}`);
  const focusText = (await win.locator('.setting-row', { hasText: '专注时长' }).locator('.stepper__value').innerText()).trim();
  assert.equal(focusText, '27 分', `专注时长未保留：${focusText}`);
  log(`版本 ${versionText}，主题 ${activeTheme}，专注 ${focusText} 均已保留`);

  await win.screenshot({ path: screenshotPath });
  log(`截图 ${screenshotPath}`);
}

try {
  await main();
  console.log('\nPASS real upgrade：0.2.0 安装 → 检查/下载/安装 0.2.1 → 版本与设置保留');
} catch (err) {
  console.error('\nFAIL real upgrade：', err);
  process.exitCode = 1;
} finally {
  if (app !== null) {
    await app.close().catch(() => undefined);
  }
  try {
    killInstalled();
    if (existsSync(uninstaller)) {
      execFileSync(uninstaller, ['/S'], { timeout: 120_000 });
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  } catch (err) {
    console.error('清理安装失败：', err);
  }
  rmSync(installDir, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
  for (const shortcut of [
    join(process.env.USERPROFILE, 'Desktop', '番茄钟挂件.lnk'),
    join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', '番茄钟挂件.lnk'),
  ]) {
    rmSync(shortcut, { force: true });
  }
  if (server !== null) {
    await new Promise((resolve) => server.close(resolve));
  }
}
