/**
 * 历史统计与数据安全 e2e：
 * ① 设置页近 7 天柱状图 7 根、合计区块存在
 * ② 跳过专注 → 统计 +1
 * ③ 连续改设置 → 自动生成 .bak
 * ④ 破坏主数据文件 → 重启后从 .bak 恢复设置与统计
 *
 * 运行：node tests/e2e/stats-data.spec.mjs（需先构建）
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), 'pomodoro-stats-e2e-'));
const env = {
  ...process.env,
  POMODORO_E2E: '1',
  POMODORO_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

let app = null;

async function launch() {
  app = await electron.launch({ args: ['.'], cwd: projectRoot, env, timeout: 30_000 });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector('.app-shell', { timeout: 15_000 });
  return win;
}

async function main() {
  let win = await launch();

  // ① 设置页历史图
  await win.getByRole('button', { name: '设置' }).click();
  await win.waitForSelector('.history-chart__col', { timeout: 10_000 });
  assert.equal(await win.locator('.history-chart__col').count(), 7, '应渲染 7 根日柱');
  assert.equal(await win.locator('.history-chart__tomato').count(), 7, '每天应有一枚小番茄');
  assert.match(
    await win.locator('.history-chart__hint').innerText(),
    /当天番茄数|开始第一个番茄/,
    '应有图表说明或空态提示'
  );
  assert.equal(
    await win.locator('.history-chart__col--today').count(),
    1,
    '应高亮今天'
  );
  const summary = await win
    .locator('.settings-panel__group')
    .filter({ hasText: '近 7 天' })
    .innerText();
  assert.match(summary, /近 7 天/, '应显示近 7 天区块');
  console.log('  ✓ 设置页近 7 天柱状图 7 根');

  // ② 跳过专注，统计 +1
  await win.getByRole('button', { name: '返回' }).click();
  await win.getByRole('button', { name: '开始', exact: true }).click();
  // 主进程 1s tick 后才推进 remaining；等过一个 tick，skip 才会结算实际时长
  await win.waitForTimeout(1_500);
  await win.getByRole('button', { name: '跳过', exact: true }).click();
  await win.waitForTimeout(500);
  const stats = await win.evaluate(() => window.pomodoro.stats.get());
  assert.equal(stats.ok, true);
  assert.equal(stats.data.completedPomodoros, 1, '跳过应结算 1 个番茄');
  console.log('  ✓ 跳过专注后今日统计 +1');

  // ③ 连续改设置 → 产生 .bak
  await win.getByRole('button', { name: '设置' }).click();
  await win.waitForSelector('.settings-panel');
  await win.getByRole('button', { name: '专注时长增加' }).click();
  await win.getByRole('button', { name: '专注时长增加' }).click();
  await win.waitForTimeout(500);
  const settings = await win.evaluate(() => window.pomodoro.settings.get());
  assert.equal(settings.data.focusMinutes, 27, '两次 + 后专注时长应为 27');

  await app.close().catch(() => {});
  app = null;
  await new Promise((resolve) => setTimeout(resolve, 600));

  const dataFile = join(userDataDir, 'pomodoro-data.json');
  const backupFile = `${dataFile}.bak`;
  assert.ok(existsSync(backupFile), '应生成 .bak 自动备份');
  const backup = JSON.parse(readFileSync(backupFile, 'utf-8'));
  assert.equal(backup.settings.focusMinutes, 26, '.bak 应保存上一版设置');
  console.log('  ✓ 连续修改设置生成上一版 .bak');

  // ④ 破坏主文件 → 重启从 .bak 恢复
  writeFileSync(dataFile, '{ broken json', 'utf-8');
  win = await launch();
  const restoredSettings = await win.evaluate(() => window.pomodoro.settings.get());
  assert.equal(restoredSettings.data.focusMinutes, 26, '主文件损坏应回退 .bak 设置');
  const restoredStats = await win.evaluate(() => window.pomodoro.stats.get());
  assert.equal(restoredStats.data.completedPomodoros, 1, '主文件损坏应回退 .bak 统计');
  const history = await win.evaluate(() => window.pomodoro.stats.getHistory(7));
  assert.equal(history.data.days.length, 7);
  assert.ok(history.data.totalPomodoros >= 1, '历史统计应包含已完成的番茄');
  console.log('  ✓ 主数据文件损坏后从 .bak 恢复设置与统计');

  console.log('\nPASS e2e stats-data：历史图 / 跳过统计 / 自动备份 / 损坏恢复');
}

try {
  await main();
} finally {
  if (app !== null) {
    await app.close().catch(() => {});
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows 上日志句柄可能延迟释放
  }
}
