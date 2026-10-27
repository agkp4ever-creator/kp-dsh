/**
 * 轻量断言：窗口三模式尺寸切换「收缩修复」（不依赖 Electron 运行时，node 直跑）。
 *
 * 背景 Bug：设置页 320×420 返回主界面 240×240 时窗口尺寸不恢复。
 * 原理（Windows）：resizable:false 的窗口当前尺寸被 WM_GETMINMAXINFO 当作
 * ptMinTrackSize（最小轨迹尺寸）——裸 setSize/setBounds 收缩被系统静默钳回，
 * 放大不受限（故 240→320×420 正常、320×420→240 不生效）。
 * 修复：setFocusable → setResizable(true) → setBounds(显式带位置+目标尺寸) → setResizable(false)。
 *
 * 本脚本两步证明：
 * 1. 静态断言：src/main/window.ts 的 applyWindowMode 调用序列、setBounds 参数、
 *    构造保留 resizable:false、WINDOW_SIZES 三模式尺寸常量；
 * 2. 模拟断言：用 mock 复现「非 resizable 收缩钳制」，跑一遍静态断言所锁定的
 *    规范调用序列（源码序列已与规范序列逐项比对一致），证明收缩可生效、
 *    且旧序列（裸 setSize）在同一 mock 上复现 Bug。
 *
 * 运行：node tests/window-mode-resize-assert.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windowTs = readFileSync(join(root, 'src', 'main', 'window.ts'), 'utf-8');
const indexTs = readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf-8');
const constantsTs = readFileSync(join(root, 'src', 'shared', 'constants.ts'), 'utf-8');
const trayTs = readFileSync(join(root, 'src', 'main', 'tray.ts'), 'utf-8');
const typesTs = readFileSync(join(root, 'src', 'shared', 'types.ts'), 'utf-8');
const storeTs = readFileSync(join(root, 'src', 'main', 'store.ts'), 'utf-8');
const settingsPanelTs = readFileSync(
  join(root, 'src', 'renderer', 'src', 'components', 'SettingsPanel.tsx'),
  'utf-8'
);

let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('== 1. 静态断言：applyWindowMode 源码形态 ==');

// 截取 applyWindowMode 函数体（闭合 } 顶格，函数体内无顶格嵌套块）
const fnMatch = windowTs.match(/export function applyWindowMode[\s\S]*?\n\}/);
check('存在导出的 applyWindowMode', fnMatch !== null);
const body = fnMatch ? fnMatch[0] : '';

const iFocus = body.indexOf('setFocusable');
const iResTrue = body.indexOf('setResizable(true)');
const iBounds = body.indexOf('setBounds(');
const iResFalse = body.indexOf('setResizable(false)');

check(
  '调用顺序 setFocusable → setResizable(true) → setBounds → setResizable(false)',
  iFocus !== -1 && iFocus < iResTrue && iResTrue < iBounds && iBounds < iResFalse,
  `实际下标 focus=${iFocus} resTrue=${iResTrue} bounds=${iBounds} resFalse=${iResFalse}`
);
check(
  'setBounds 显式携带当前位置 x,y + 目标尺寸 width,height（避免位置漂移）',
  /setBounds\(\{\s*x,\s*y,\s*width:\s*size\.width,\s*height:\s*size\.height\s*\}\)/.test(body)
);
check('applyWindowMode 内不再出现裸 setSize（收缩钳制根因）', !body.includes('setSize('));
check('resize 后还原 setResizable(false)（用户仍不可手动缩放）', iResFalse !== -1);
check(
  '构造保留 resizable: false（不破坏挂件固定尺寸形态）',
  /resizable:\s*false/.test(windowTs) && !/resizable:\s*true/.test(windowTs)
);

console.log('== 2. 静态断言：WINDOW_SIZES 三模式尺寸常量 ==');

const sizeMatch = constantsTs.match(/WINDOW_SIZES[\s\S]*?\n\};/);
check('存在 WINDOW_SIZES 定义', sizeMatch !== null);
const sizeText = sizeMatch ? sizeMatch[0] : '';
function hasSize(mode, w, h) {
  return new RegExp(`${mode}:\\s*\\{\\s*width:\\s*${w},\\s*height:\\s*${h}\\s*\\}`).test(sizeText);
}
check('normal 240×240', hasSize('normal', 240, 240));
check('compact 160×160', hasSize('compact', 160, 160));
check('settings 320×420', hasSize('settings', 320, 420));

console.log('== 3. 静态断言：最小化/还原动画与半透明 ==');

check(
  'applyWindowMode 接受 animate 参数（默认 false，不影响设置页/启动）',
  /export function applyWindowMode\(\s*win: BrowserWindow,\s*mode: WindowMode,\s*animate = false,\s*clickThrough = false\s*\)/.test(
    windowTs
  )
);
check(
  'compact 目标不透明度取 WINDOW_COMPACT_OPACITY，normal/settings 为 1',
  /const targetOpacity = mode === 'compact' \? WINDOW_COMPACT_OPACITY : 1/.test(body)
);
check(
  '动画分支同时补间 bounds 与 opacity',
  /animateWindowBounds\(win, target, \{ from: win\.getOpacity\(\), to: targetOpacity \}\)/.test(body)
);
check(
  'animateWindowBounds 终帧显式落地 opacity.to',
  /if \(opacity !== undefined\) \{\s*win\.setOpacity\(opacity\.to\)/.test(windowTs)
);
check(
  'animateWindowBounds 逐帧插值 opacity',
  /win\.setOpacity\(opacity\.from \+ \(opacity\.to - opacity\.from\) \* progress\)/.test(windowTs)
);
check(
  '模式切换前取消进行中的动画，避免旧 timer 写回旧目标',
  /cancelDockAnimation\(\);[\s\S]{0,220}const size = WINDOW_SIZES\[mode\]/.test(body)
);
check(
  '同模式重复请求直接忽略（双击最小化不重启动画）',
  /if \(previousMode === mode\) \{\s*return;/.test(indexTs)
);
check(
  '仅 compact 或 compact→normal 启用动画，settings 保持即时',
  /const animated = mode === 'compact' \|\| \(previousMode === 'compact' && mode === 'normal'\)/.test(
    indexTs
  )
);
check(
  'compact 不透明度常量为 0.62',
  /WINDOW_COMPACT_OPACITY = 0\.62/.test(constantsTs)
);

console.log('== 3b. 静态断言：紧凑态鼠标穿透与唤回 ==');

check(
  '窗口穿透 helper 调用 setIgnoreMouseEvents',
  /export function setWindowClickThrough[\s\S]{0,220}setIgnoreMouseEvents/.test(windowTs)
);
check(
  'applyWindowMode 仅 compact 且开关开启时穿透',
  /setWindowClickThrough\(win, mode === 'compact' && clickThrough\)/.test(body)
);
check('Settings 增加 compactClickThrough 字段', /compactClickThrough: boolean/.test(typesTs));
check('默认开启紧凑态穿透', /compactClickThrough: true/.test(constantsTs));
check(
  '设置清洗白名单包含 compactClickThrough',
  /key === 'compactClickThrough'/.test(storeTs) && /applyBoolean\('compactClickThrough'\)/.test(storeTs)
);
check(
  'setWindowMode 读取 compactClickThrough 设置',
  /settingsService\.get\(\)\.compactClickThrough/.test(indexTs)
);
check(
  '托盘双击走 expandWindow',
  /this\.tray\.on\('double-click'[\s\S]{0,120}expandWindow\(\)/.test(trayTs)
);
check('托盘菜单包含「展开挂件」', /label: '展开挂件'/.test(trayTs));
check('托盘提供首次紧凑态提示', /showCompactHint/.test(trayTs));
check(
  '全局快捷键注册 RESTORE_SHORTCUT',
  /globalShortcut\.register\(RESTORE_SHORTCUT, expandFromCompact\)/.test(indexTs)
);
check('退出时注销全局快捷键', /globalShortcut\.unregisterAll\(\)/.test(indexTs));
check('设置面板包含「紧凑态鼠标穿透」开关', /紧凑态鼠标穿透/.test(settingsPanelTs));

console.log('== 4. 模拟断言：Windows 收缩钳制行为 ==');

/**
 * mock 窗口：复现 Windows 对 resizable:false 窗口的 WM_GETMINMAXINFO 行为——
 * 当前尺寸即 ptMinTrackSize，setBounds 各轴收缩被钳回、放大放行（静默）。
 */
function makeWin(width, height) {
  return {
    x: 100,
    y: 100,
    width,
    height,
    resizable: false,
    focusable: false,
    setResizable(v) {
      this.resizable = v;
    },
    setFocusable(v) {
      this.focusable = v;
    },
    getBounds() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    },
    setBounds(b) {
      // 非 resizable：各轴只能放大不能缩小（模拟系统钳制，收缩被静默忽略）
      const clamp = (next, cur) => (this.resizable ? next : Math.max(next, cur));
      this.width = clamp(b.width, this.width);
      this.height = clamp(b.height, this.height);
      this.x = b.x;
      this.y = b.y;
    },
    // 旧实现入口：setSize 保持位置改尺寸，与 setBounds 共用同一套钳制语义
    setSize(width, height) {
      this.setBounds({ x: this.x, y: this.y, width, height });
    },
  };
}

// 规范序列 = 静态断言锁定的 applyWindowMode 调用序列（两处必须同步维护）
function applyModeCanonical(win, mode) {
  const sizes = {
    normal: { width: 240, height: 240 },
    compact: { width: 160, height: 160 },
    settings: { width: 320, height: 420 },
  };
  const size = sizes[mode];
  win.setFocusable(mode === 'settings');
  win.setResizable(true);
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: size.width, height: size.height });
  win.setResizable(false);
}

// 旧序列 = Bug 修复前实现（裸 setSize + 后置 setFocusable），用于复现 Bug
function applyModeLegacy(win, mode) {
  const sizes = {
    normal: { width: 240, height: 240 },
    compact: { width: 160, height: 160 },
    settings: { width: 320, height: 420 },
  };
  const size = sizes[mode];
  win.setSize(size.width, size.height);
  win.setFocusable(mode === 'settings');
}

// 4.1 旧序列复现 Bug：320×420 → 240×240 收缩被钳制
const legacyWin = makeWin(240, 240);
applyModeLegacy(legacyWin, 'settings');
applyModeLegacy(legacyWin, 'normal');
check(
  '旧序列复现 Bug：settings→normal 收缩被钳制停在 320×420',
  legacyWin.width === 320 && legacyWin.height === 420,
  `实际 ${legacyWin.width}×${legacyWin.height}`
);

// 4.2 新序列：三模式两两互切（6 条路径）全部落到目标尺寸
const modes = [
  ['normal', 240, 240],
  ['compact', 160, 160],
  ['settings', 320, 420],
];
let allRoutesOk = true;
const routeDetail = [];
for (const [from, fw, fh] of modes) {
  for (const [to, tw, th] of modes) {
    if (from === to) {
      continue;
    }
    const win = makeWin(fw, fh);
    applyModeCanonical(win, to);
    const ok =
      win.width === tw &&
      win.height === th &&
      win.resizable === false &&
      win.focusable === (to === 'settings') &&
      win.x === 100 &&
      win.y === 100;
    if (!ok) {
      allRoutesOk = false;
      routeDetail.push(
        `${from}→${to} 得到 ${win.width}×${win.height} res=${win.resizable} focus=${win.focusable} pos=${win.x},${win.y}`
      );
    }
  }
}
check(
  '新序列三模式 6 条互切路径全部正确（尺寸/focusable/位置/resizable 还原）',
  allRoutesOk,
  routeDetail.join('; ')
);

// 4.3 场景回放：进设置→返回（Bug 主诉路径）
const scenario = makeWin(240, 240);
applyModeCanonical(scenario, 'settings');
const enterOk = scenario.width === 320 && scenario.height === 420 && scenario.focusable === true;
applyModeCanonical(scenario, 'normal');
const backOk = scenario.width === 240 && scenario.height === 240 && scenario.focusable === false;
check('场景回放：进设置 320×420 + setFocusable(true)', enterOk);
check('场景回放：返回主界面恢复 240×240 + setFocusable(false)', backOk);

console.log('');
if (failed > 0) {
  console.error(`断言失败 ${failed} 项`);
  process.exit(1);
}
console.log('全部断言通过');
