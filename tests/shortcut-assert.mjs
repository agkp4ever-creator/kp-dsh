/**
 * 轻量断言：全局唤回快捷键的候选降级与展示（不依赖 Electron 运行时）。
 *
 * 背景：v0.3.3 固定注册 Ctrl+Alt+P，用户机器上该组合被其他软件占用，
 * register 返回 false 后没有任何降级，表现为“快捷键无效”。
 *
 * 覆盖：
 * ① formatShortcutLabel 纯函数
 * ② 候选顺序与默认值
 * ③ 主进程按候选注册并记录实际组合
 * ④ IPC / preload / 设置页展示接线
 *
 * 运行：node tests/shortcut-assert.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const constantsTs = readFileSync(join(root, 'src', 'shared', 'constants.ts'), 'utf-8');
const indexTs = readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf-8');
const ipcTs = readFileSync(join(root, 'src', 'main', 'ipc.ts'), 'utf-8');
const preloadTs = readFileSync(join(root, 'src', 'preload', 'index.ts'), 'utf-8');
const settingsPanelTs = readFileSync(
  join(root, 'src', 'renderer', 'src', 'components', 'SettingsPanel.tsx'),
  'utf-8'
);
const readme = readFileSync(join(root, 'README-pomodoro.md'), 'utf-8');

const staging = mkdtempSync(join(tmpdir(), 'pomodoro-shortcut-'));
try {
  const code = stripTypeScriptTypes(
    readFileSync(join(root, 'src', 'shared', 'shortcut.ts'), 'utf-8'),
    { mode: 'strip' }
  );
  const target = join(staging, 'shortcut.mjs');
  writeFileSync(target, code, 'utf-8');
  const M = await import(pathToFileURL(target).href);

  console.log('① formatShortcutLabel：accelerator 转界面文案');
  check('默认组合 → Ctrl + Alt + P', M.formatShortcutLabel('CommandOrControl+Alt+P') === 'Ctrl + Alt + P');
  check('降级组合 → Ctrl + Alt + Shift + P', M.formatShortcutLabel('CommandOrControl+Alt+Shift+P') === 'Ctrl + Alt + Shift + P');
  check('纯 Alt 组合保留原样', M.formatShortcutLabel('Alt+Shift+P') === 'Alt + Shift + P');
  check('不再出现 CommandOrControl', !M.formatShortcutLabel('CommandOrControl+Alt+P').includes('CommandOrControl'));

  console.log('② 候选顺序与默认值');
  check('默认快捷键为 Ctrl+Alt+P', /RESTORE_SHORTCUT = RESTORE_SHORTCUT_CANDIDATES\[0\]/.test(constantsTs));
  check(
    '候选包含默认、Ctrl+Alt+Shift+P、Alt+Shift+P',
    /CommandOrControl\+Alt\+P'/.test(constantsTs) &&
      /CommandOrControl\+Alt\+Shift\+P'/.test(constantsTs) &&
      /Alt\+Shift\+P'/.test(constantsTs)
  );

  console.log('③ 主进程按候选降级并记录实际组合');
  check(
    '遍历候选并逐个 register',
    /for \(const accelerator of RESTORE_SHORTCUT_CANDIDATES\)/.test(indexTs) &&
      /globalShortcut\.register\(accelerator, expandFromCompact\)/.test(indexTs)
  );
  check(
    '成功后记录 accelerator 与可读 label',
    /restoreShortcut = accelerator/.test(indexTs) &&
      /restoreShortcutLabel = formatShortcutLabel\(accelerator\)/.test(indexTs)
  );
  check('失败时记录 warning，不阻塞托盘唤回', /restore shortcut unavailable/.test(indexTs));
  check('全部失败有兜底日志', /all candidates unavailable/.test(indexTs));

  console.log('④ IPC / preload / 设置页展示');
  check('constants 定义 SHORTCUT_GET', /SHORTCUT_GET: 'shortcut:get'/.test(constantsTs));
  check('ipc 注册 SHORTCUT_GET 并返回 getShortcutInfo', /SHORTCUT_GET[\s\S]{0,180}getShortcutInfo/.test(ipcTs));
  check('preload 暴露 app.getShortcut', /getShortcut: \(\): Promise<IpcResult<ShortcutInfo>>/.test(preloadTs));
  check(
    '设置页用实际快捷键渲染提示',
    /restoreShortcut: string/.test(settingsPanelTs) &&
      /按 \{restoreShortcut\} 展开/.test(settingsPanelTs)
  );
  check('README 说明冲突降级', /Ctrl\+Alt\+Shift\+P/.test(readme) && /Alt\+Shift\+P/.test(readme));

  console.log(failed === 0 ? '\n快捷键降级断言全部通过' : `\n${failed} 项失败`);
  if (failed > 0) process.exitCode = 1;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
