/**
 * 主题扩展断言：六族配色、resolveTheme 行为、tokens.css 深浅变体、设置校验。
 * 不依赖 Electron / 浏览器，node 直跑。
 *
 * 运行：node tests/theme-assert.mjs
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

const read = (rel) => readFileSync(join(root, rel), 'utf-8');

// ---------- 把 theme.ts 转成可 import 的 ESM ----------
const staging = mkdtempSync(join(tmpdir(), 'pomodoro-theme-'));
try {
  const code = stripTypeScriptTypes(read('src/renderer/src/theme.ts'), { mode: 'strip' });
  const target = join(staging, 'theme.mjs');
  writeFileSync(target, code, 'utf-8');
  const { resolveTheme } = await import(pathToFileURL(target).href);

  console.log('① 配色族清单');
  const types = read('src/shared/types.ts');
  const names = ['minimal', 'tomato', 'forest', 'ocean', 'lavender', 'system'];
  for (const name of names) {
    check(`THEME_NAMES 含 ${name}`, types.includes(`'${name}'`));
  }
  check(
    'ThemeName 由 THEME_NAMES 推导（避免类型与校验漂移）',
    /export type ThemeName = \(typeof THEME_NAMES\)\[number\]/.test(types)
  );

  console.log('② resolveTheme：配色族与明暗变体');
  for (const name of ['tomato', 'forest', 'ocean', 'lavender']) {
    const dark = resolveTheme(name, 'dark');
    const light = resolveTheme(name, 'light');
    check(`${name} 深色`, dark.palette === name && dark.variant === 'dark');
    check(`${name} 浅色`, light.palette === name && light.variant === 'light');
  }
  const minimalLight = resolveTheme('minimal', 'light');
  check('minimal 锁定深色经典款', minimalLight.palette === 'minimal' && minimalLight.variant === 'dark');
  const systemLight = resolveTheme('system', 'light');
  const systemDark = resolveTheme('system', 'dark');
  check(
    'system 复用 minimal 并跟随系统明暗',
    systemLight.palette === 'minimal' &&
      systemLight.variant === 'light' &&
      systemDark.palette === 'minimal' &&
      systemDark.variant === 'dark'
  );

  console.log('③ tokens.css：每族深浅两套变量');
  const tokens = read('src/renderer/src/styles/tokens.css');
  for (const name of ['forest', 'ocean', 'lavender']) {
    check(`${name} 深色选择器`, tokens.includes(`:root[data-theme='${name}']`));
    check(`${name} 浅色选择器`, tokens.includes(`:root[data-theme='${name}'][data-scheme='light']`));
  }
  check(
    '浅色通用结构块存在（新主题只覆盖色彩）',
    /:root\[data-scheme='light'\]\s*\{[^}]*--btn-bg:/.test(tokens)
  );

  console.log('④ 设置校验与面板选项');
  const store = read('src/main/store.ts');
  check(
    'store 用 THEME_NAMES 白名单校验',
    store.includes('THEME_NAMES') && store.includes('includes(theme)')
  );
  const panel = read('src/renderer/src/components/SettingsPanel.tsx');
  const labels = ['极简黑白', '番茄红', '森林绿', '深海蓝', '薰衣草', '跟随系统'];
  for (const label of labels) {
    check(`面板含「${label}」`, panel.includes(label));
  }
  check('面板用 map 渲染主题选项', panel.includes('THEME_OPTIONS.map'));

  console.log('⑤ 主题选择布局');
  const css = read('src/renderer/src/styles/global.css');
  check(
    'theme-picker 为 3 列网格（6 选项两行）',
    /\.theme-picker\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/s.test(css)
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n主题扩展断言失败 ${failed} 项`);
  process.exit(1);
}
console.log('\n主题扩展断言全部通过');
