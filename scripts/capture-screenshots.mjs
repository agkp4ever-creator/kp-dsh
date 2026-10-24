/**
 * 生成 README 截图（使用最新绿色版，临时 userData，不污染真实数据）。
 * 运行：node scripts/capture-screenshots.mjs
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = join(root, 'release', '番茄钟挂件-portable', '番茄钟挂件.exe');
const outDir = join(root, 'docs', 'screenshots');
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-shot-'));
mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const shot = (win, name) => win.screenshot({ path: join(outDir, `${name}.png`) });

async function main() {
  const app = await electron.launch({
    executablePath: exe,
    env,
    timeout: 30_000,
  });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.timer-ring', { timeout: 15_000 });
  await win.waitForTimeout(1_000);

  // 主界面（准备专注）
  await shot(win, 'main');

  // 专注中
  await win.getByRole('button', { name: '开始', exact: true }).click();
  await win.waitForTimeout(2_200);
  await shot(win, 'running');

  // 紧凑态（半透明）
  await win.getByRole('button', { name: '紧凑模式', exact: true }).click();
  await win.waitForSelector('.app-shell--compact', { timeout: 5_000 });
  await win.waitForTimeout(700);
  await shot(win, 'compact');
  await win.locator('.app-shell--compact').click({ position: { x: 80, y: 80 } });
  await win.waitForSelector('.titlebar', { timeout: 5_000 });
  await win.waitForTimeout(600);

  // 设置页
  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForSelector('.settings-panel', { timeout: 5_000 });
  await win.waitForTimeout(400);
  await shot(win, 'settings');
  await win.locator('.settings-panel').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await win.waitForTimeout(300);
  await shot(win, 'settings-theme');

  // 三套新主题的主界面
  await win.getByRole('button', { name: '森林绿', exact: true }).click();
  await win.waitForTimeout(300);
  await win.getByRole('button', { name: '完成', exact: true }).click();
  await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
  await win.waitForTimeout(300);
  await shot(win, 'theme-forest');

  for (const [theme, name] of [
    ['深海蓝', 'theme-ocean'],
    ['薰衣草', 'theme-lavender'],
  ]) {
    await win.getByRole('button', { name: '设置', exact: true }).click();
    await win.waitForSelector('.settings-panel', { timeout: 5_000 });
    await win.getByRole('button', { name: theme, exact: true }).click();
    await win.waitForTimeout(250);
    await win.getByRole('button', { name: '完成', exact: true }).click();
    await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
    await win.waitForTimeout(250);
    await shot(win, name);
  }

  await app.close();
  console.log(`截图已生成：${outDir}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });
