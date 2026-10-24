/**
 * 历史统计与数据安全断言（node 直跑，不依赖 Electron）：
 * ① buildHistory 补零/升序/合计/跨月/边界
 * ② store 备份与导入解析（静态约束）
 * ③ IPC/preload/设置面板入口（静态约束）
 *
 * 运行：node tests/stats-data-assert.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60_000;

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(...parts) {
  return readFileSync(join(root, ...parts), 'utf-8');
}

// ---------- 把 history.ts 转成可 import 的 ESM（format 一并转译） ----------
const staging = mkdtempSync(join(tmpdir(), 'pomodoro-stats-'));
try {
  const formatCode = stripTypeScriptTypes(read('src', 'shared', 'format.ts'), { mode: 'strip' });
  writeFileSync(join(staging, 'format.mjs'), formatCode, 'utf-8');
  const historyCode = stripTypeScriptTypes(read('src', 'shared', 'history.ts'), {
    mode: 'strip',
  }).replace("from './format'", "from './format.mjs'");
  const target = join(staging, 'history.mjs');
  writeFileSync(target, historyCode, 'utf-8');
  const M = await import(pathToFileURL(target).href);

  console.log('① buildHistory：近 7 天补零与合计');
  const today = new Date(2026, 9, 24);
  const stats = {
    '2026-10-24': { date: '2026-10-24', completedPomodoros: 2, focusMs: 50 * MIN },
    '2026-10-22': { date: '2026-10-22', completedPomodoros: 1, focusMs: 25 * MIN },
  };
  const week = M.buildHistory(today, stats, 7);
  check('返回 7 天', week.days.length === 7);
  check('升序且含今天', week.days[0].date === '2026-10-18' && week.days[6].date === '2026-10-24');
  check('缺失日期补零', week.days[1].completedPomodoros === 0 && week.days[1].focusMs === 0);
  check('合计番茄数', week.totalPomodoros === 3, String(week.totalPomodoros));
  check('合计专注时长', week.totalFocusMs === 75 * MIN, String(week.totalFocusMs));

  console.log('② 跨月与边界');
  const crossMonth = M.buildHistory(new Date(2026, 2, 2), {}, 3);
  check(
    '跨月正确（3/2 往前 3 天 = 2/28..3/2）',
    crossMonth.days.map((d) => d.date).join(',') === '2026-02-28,2026-03-01,2026-03-02',
    crossMonth.days.map((d) => d.date).join(',')
  );
  check('days=1 只含今天', M.buildHistory(today, stats, 1).days.length === 1);
  check('days=0 夹到 1', M.clampHistoryDays(0) === 1);
  check('days=99 夹到 30', M.clampHistoryDays(99) === 30);
  check('NaN 天数回默认 7', M.clampHistoryDays(Number.NaN) === 7);
  const negative = M.buildHistory(today, {
    '2026-10-24': { date: '2026-10-24', completedPomodoros: -3, focusMs: -100 },
  }, 1);
  check('负值归零', negative.days[0].completedPomodoros === 0 && negative.days[0].focusMs === 0);

  console.log('③ 备份/导入后端（静态约束）');
  const store = read('src', 'main', 'store.ts');
  check('store 提供 .bak 路径', store.includes('backupFilePath'));
  check('store 写入前备份旧文件', store.includes('copyFileSync') && store.includes('backupFilePath()'));
  check('store 主文件损坏回退 .bak', store.includes('for (const file of [persistFilePath(), backupFilePath()])'));
  check('store 导出 parsePersistData 供导入校验', store.includes('export function parsePersistData'));

  const statsSrc = read('src', 'main', 'stats.ts');
  check('StatsService 有 getHistory', statsSrc.includes('getHistory(days = 7)') && statsSrc.includes('buildHistory'));
  check('StatsService 有 reload 并广播', statsSrc.includes('reload(): DailyStats') && statsSrc.includes('this.notify()'));

  const dataSrc = read('src', 'main', 'dataTransfer.ts');
  check('导出/导入使用系统对话框', dataSrc.includes('showSaveDialog') && dataSrc.includes('showOpenDialog'));
  check('导入限制 2MB', dataSrc.includes('MAX_IMPORT_BYTES') && dataSrc.includes('2 * 1024 * 1024'));
  check('导入覆盖设置与统计', dataSrc.includes('settingsService.replace') && dataSrc.includes('statsService.reload'));
  check('导入保留当前窗口位置', dataSrc.includes('windowPos: current.windowPos'));

  console.log('④ IPC / preload / UI 入口（静态约束）');
  const ipc = read('src', 'main', 'ipc.ts');
  check('IPC 注册 stats:history', ipc.includes('STATS_HISTORY') && ipc.includes('getHistory(days)'));
  check('IPC 注册 data:export/import', ipc.includes('DATA_EXPORT') && ipc.includes('DATA_IMPORT'));
  const preload = read('src', 'preload', 'index.ts');
  check('preload 暴露历史与备份', preload.includes('getHistory') && preload.includes('exportJson') && preload.includes('importJson'));
  const panel = read('src', 'renderer', 'src', 'components', 'SettingsPanel.tsx');
  check('设置面板有近 7 天区块', panel.includes('近 7 天') && panel.includes('HistoryChart'));
  check('设置面板有导出/导入按钮', panel.includes('导出备份') && panel.includes('导入备份'));
  const app = read('src', 'renderer', 'src', 'App.tsx');
  check('App 拉取历史并调用备份 API', app.includes('getHistory(7)') && app.includes('data.exportJson') && app.includes('data.importJson'));
  check('HistoryChart 组件存在', read('src', 'renderer', 'src', 'components', 'HistoryChart.tsx').includes('近 7 天番茄数'));
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
