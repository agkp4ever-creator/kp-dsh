/**
 * UI 截图辅助：启动挂件，截主窗口/设置页/滚动条/主题色卡，供人工视觉验收。
 * 运行：node tests/e2e/ui-shot.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = join(projectRoot, 'release', 'ui-shots');
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-ui-'));
mkdirSync(outDir, { recursive: true });

// 写入近 7 天示例数据，方便检查小番茄、柱高和主题配色
const counts = [1, 3, 0, 5, 2, 4, 6];
const statsByDate = {};
for (let i = 0; i < counts.length; i += 1) {
  const date = new Date();
  date.setDate(date.getDate() - (counts.length - 1 - i));
  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  statsByDate[key] = {
    date: key,
    completedPomodoros: counts[i],
    focusMs: counts[i] * 25 * 60 * 1000,
  };
}
writeFileSync(
  join(userDataDir, 'pomodoro-data.json'),
  JSON.stringify({ statsByDate }, null, 2),
  'utf-8'
);

const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ args: ['.'], cwd: projectRoot, env, timeout: 30_000 });
const win = await app.firstWindow({ timeout: 30_000 });
await win.waitForSelector('.timer-ring', { timeout: 15_000 });
await win.waitForTimeout(500);

await win.screenshot({ path: join(outDir, 'main.png') });

await win.getByRole('button', { name: '设置' }).click();
await win.waitForSelector('.settings-panel', { timeout: 5_000 });
await win.waitForTimeout(300);
await win.screenshot({ path: join(outDir, 'settings-top.png') });

await win.evaluate(() => {
  document.querySelector('.history-chart-wrap')?.scrollIntoView({ block: 'center' });
});
await win.waitForTimeout(350);
await win.screenshot({ path: join(outDir, 'settings-history.png') });

await win.evaluate(() => {
  document.querySelector('.theme-card')?.scrollIntoView({ block: 'center' });
});
await win.waitForTimeout(250);

for (const theme of ['minimal', 'tomato', 'forest', 'ocean', 'lavender', 'system']) {
  await win.locator(`.theme-card[data-theme="${theme}"]`).click();
  await win.waitForTimeout(150);
  await win.screenshot({ path: join(outDir, `settings-${theme}.png`) });
}

for (const theme of ['forest', 'tomato']) {
  await win.locator(`.theme-card[data-theme="${theme}"]`).click();
  await win.evaluate(() => {
    document.querySelector('.history-chart-wrap')?.scrollIntoView({ block: 'center' });
  });
  await win.waitForTimeout(450);
  await win.screenshot({ path: join(outDir, `settings-history-${theme}.png`) });
}

await win.locator('.theme-card[data-theme="forest"]').click();
await win.waitForTimeout(120);

await win.getByRole('button', { name: '完成', exact: true }).click();
await win.waitForSelector('.settings-panel', { state: 'detached', timeout: 5_000 });
await win.waitForTimeout(200);
await win.screenshot({ path: join(outDir, 'main-forest.png') });

// 浅色变体：强制系统浅色，检查配色与对比度
await win.getByRole('button', { name: '设置' }).click();
await win.waitForSelector('.settings-panel', { timeout: 5_000 });
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = 'light';
});
await win.waitForTimeout(350);
for (const theme of ['system', 'forest']) {
  await win.locator(`.theme-card[data-theme="${theme}"]`).click();
  await win.evaluate(() => {
    document.querySelector('.history-chart-wrap')?.scrollIntoView({ block: 'center' });
  });
  await win.waitForTimeout(350);
  await win.screenshot({ path: join(outDir, `settings-history-light-${theme}.png`) });
}

await app.close();
rmSync(userDataDir, { recursive: true, force: true });
console.log(`UI shots written to ${outDir}`);
