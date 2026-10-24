/**
 * 轻量断言：P1-7 手动收纳到屏幕侧边（方案 B）——不依赖 Electron 运行时，node 直跑。
 *
 * 与 tests/window-mode-resize-assert.mjs 同一套思路：静态断言源码形态 + 动态跑真算法。
 * 为了让「动态断言」跑的是真实现而不是测试里复制的副本，这里用 Node 的
 * module.stripTypeScriptTypes 现场擦除类型标注，把 src/shared/{constants,dock}.ts
 * 转成临时 .mjs 后 import——几何算法只有一份（src/shared/dock.ts）。
 *
 * 覆盖：
 * ① 左/右边缘判定（含多显示器工作区）
 * ② 收纳目标 bounds（10×160、贴边、垂直居中与上下钳制）
 * ③ 展开恢复原 bounds（越界钳回、compact 尺寸保持）
 * ④ 多显示器 workArea 计算（副屏 / 负坐标屏）
 * ⑤ 动画终帧 = 目标值（帧数/时长/ease-out 单调性与精确落点）
 *
 * 运行：node tests/dock-mode-assert.mjs
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

// ---------- 把真源码（TS）转成可 import 的 ESM ----------
const staging = mkdtempSync(join(tmpdir(), 'pomodoro-dock-'));
function stage(fileName, sourceFile, rewriteFrom, rewriteTo) {
  let code = stripTypeScriptTypes(readFileSync(join(root, sourceFile), 'utf-8'), {
    mode: 'strip',
  });
  if (rewriteFrom !== undefined) {
    code = code.replace(rewriteFrom, rewriteTo);
  }
  const target = join(staging, fileName);
  writeFileSync(target, code, 'utf-8');
  return pathToFileURL(target).href;
}

const constantsUrl = stage('constants.mjs', join('src', 'shared', 'constants.ts'));
const dockUrl = stage(
  'dock.mjs',
  join('src', 'shared', 'dock.ts'),
  "'./constants'",
  "'./constants.mjs'"
);

const C = await import(constantsUrl);
const D = await import(dockUrl);

/** 断言用工作区构造器 */
function rect(x, y, width, height) {
  return { x, y, width, height };
}
function eq(a, b) {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}
function show(r) {
  return `${r.width}x${r.height}@${r.x},${r.y}`;
}

console.log('== 0. 常量与「沿用收缩修复模式」的源码形态 ==');

check(
  `把手尺寸 ${C.DOCK_HANDLE_WIDTH}×${C.DOCK_HANDLE_HEIGHT}（规格 10×160）`,
  C.DOCK_HANDLE_WIDTH === 10 && C.DOCK_HANDLE_HEIGHT === 160
);
check(
  `动画 ${C.DOCK_ANIM_FRAMES} 帧 × ${C.DOCK_ANIM_FRAME_MS}ms（规格 10–12 帧 × 16ms，总时长 ≤0.6s）`,
  C.DOCK_ANIM_FRAMES >= 10 &&
    C.DOCK_ANIM_FRAMES <= 12 &&
    C.DOCK_ANIM_FRAME_MS === 16 &&
    C.DOCK_ANIM_FRAMES * C.DOCK_ANIM_FRAME_MS <= 600
);
check(
  'IPC 通道收口到 IpcChannels（window:dock / window:undock / window:docked）',
  C.IpcChannels.WINDOW_DOCK === 'window:dock' &&
    C.IpcChannels.WINDOW_UNDOCK === 'window:undock' &&
    C.IpcChannels.WINDOW_DOCKED === 'window:docked'
);

const windowTs = readFileSync(join(root, 'src', 'main', 'window.ts'), 'utf-8');
const titleBarTsx = readFileSync(
  join(root, 'src', 'renderer', 'src', 'components', 'TitleBar.tsx'),
  'utf-8'
);

// applyWindowMode 收缩修复未被破坏
const applyFn = windowTs.match(/export function applyWindowMode[\s\S]*?\n\}/);
const applyBody = applyFn ? applyFn[0] : '';
const iFocus = applyBody.indexOf('setFocusable');
const iResTrue = applyBody.indexOf('setResizable(true)');
const iBounds = applyBody.indexOf('setBounds(');
const iResFalse = applyBody.indexOf('setResizable(false)');
check(
  'applyWindowMode 仍保持 setFocusable → setResizable(true) → setBounds → setResizable(false)',
  iFocus !== -1 && iFocus < iResTrue && iResTrue < iBounds && iBounds < iResFalse,
  `下标 focus=${iFocus} resTrue=${iResTrue} bounds=${iBounds} resFalse=${iResFalse}`
);
check('applyWindowMode 内无裸 setSize（收缩钳制根因）', !applyBody.includes('setSize('));
check(
  'applyWindowMode 在收纳态先 immediate 展开再切模式（托盘「设置」不乱序）',
  /if \(dockRuntime\.docked\) \{\s*undockWindow\(win, true\)/.test(applyBody)
);

// 动画函数沿用同一修复模式
const animFn = windowTs.match(/function animateWindowBounds[\s\S]*?\n\}/);
const animBody = animFn ? animFn[0] : '';
const aFocus = animBody.indexOf('setFocusable(false)');
const aResTrue = animBody.indexOf('setResizable(true)');
const aBounds = animBody.indexOf('setBounds(');
const aResFalse = animBody.indexOf('setResizable(false)');
check(
  '收纳动画：setFocusable 在尺寸操作之前，且 setResizable(true) 先于首帧 setBounds',
  aFocus !== -1 && aFocus < aResTrue && aResTrue !== -1 && aResTrue < aBounds,
  `下标 focus=${aFocus} resTrue=${aResTrue} bounds=${aBounds}`
);
check(
  '收纳动画：终帧精确落 target 后立即 setResizable(false)',
  /frame >= DOCK_ANIM_FRAMES[\s\S]*?setBounds\(target\);[\s\S]*?setResizable\(false\);/.test(
    animBody
  ) && aResFalse !== -1
);
check('收纳动画内无裸 setSize', !animBody.includes('setSize('));

// 位置持久化保护
const persistFn = windowTs.match(/export function persistWindowPos[\s\S]*?\n\}/);
check(
  'persistWindowPos 在收纳态/动画期间跳过落盘（不覆盖 windowPos 记忆）',
  persistFn !== null && persistFn[0].includes('isMoveSuppressed()')
);
check(
  'moved 事件在收纳态/动画期间跳过吸附与落盘',
  /win\.on\('moved',[\s\S]{0,200}isMoveSuppressed\(\)/.test(windowTs)
);
check(
  'dockToEdge 以 screen.getDisplayMatching(...).workArea 计算边缘（多显示器）',
  /export function dockToEdge[\s\S]*?screen\.getDisplayMatching\(from\)\.workArea/.test(windowTs)
);
check(
  '渲染层仅在 normal 模式渲染「收纳」按钮',
  /windowMode === 'normal' && onDock !== undefined/.test(titleBarTsx)
);

console.log('== ① 左/右边缘判定（窗口中心 vs 工作区中心） ==');
const waMain = rect(0, 0, 1920, 1040);
check(
  '窗口在左半区 → left',
  D.resolveDockSide(rect(100, 300, 240, 240), waMain) === 'left'
);
check(
  '窗口在右半区 → right',
  D.resolveDockSide(rect(1600, 300, 240, 240), waMain) === 'right'
);
check(
  '正好压在中心线上 → right（严格小于才判左，与实现一致）',
  D.resolveDockSide(rect(1920 / 2 - 120, 300, 240, 240), waMain) === 'right'
);
check(
  '窗口中心线偏左一点 → left',
  D.resolveDockSide(rect(1920 / 2 - 121, 300, 240, 240), waMain) === 'left'
);

console.log('== ② 收纳目标 bounds：10×160 / 贴边 / 垂直居中 + 钳制 ==');
const dockRight = D.resolveDockBounds(rect(1600, 300, 240, 240), waMain, 'right');
check(
  '右侧贴边 x = workArea 右缘 − 10，垂直居中 y = 中心 − 80',
  eq(dockRight, rect(1910, 340, 10, 160)),
  show(dockRight)
);
const dockLeft = D.resolveDockBounds(rect(100, 300, 240, 240), waMain, 'left');
check('左侧贴边 x = workArea.x', eq(dockLeft, rect(0, 340, 10, 160)), show(dockLeft));
const dockTop = D.resolveDockBounds(rect(1600, -100, 240, 240), waMain, 'right');
check(
  '顶部越界 → y 钳回工作区上沿',
  dockTop.y === 0 && dockTop.height === 160,
  show(dockTop)
);
const dockBottom = D.resolveDockBounds(rect(1600, 900, 240, 240), waMain, 'right');
check(
  '底部越界 → y 钳到 workArea.bottom − 160（不压任务栏）',
  dockBottom.y === 1040 - 160,
  show(dockBottom)
);
const dockTaskbar = D.resolveDockBounds(rect(1600, 40, 240, 240), rect(0, 40, 1920, 1000), 'left');
check(
  '带顶部任务栏的工作区（y=40）→ 贴 y=40 起算',
  dockTaskbar.y === 40 + 120 - 80 && dockTaskbar.x === 0,
  show(dockTaskbar)
);

console.log('== ③ 展开恢复收纳前 bounds（越界钳回） ==');
const pre = rect(1500, 700, 240, 240);
check(
  '未越界 → 原样恢复（位置 + normal 240×240）',
  eq(D.resolveUndockBounds(pre, waMain), pre)
);
check(
  'compact 160×160 → 恢复原尺寸（不强制 normal）',
  eq(D.resolveUndockBounds(rect(800, 600, 160, 160), waMain), rect(800, 600, 160, 160))
);
check(
  '右下越界 → 钳回工作区内',
  eq(D.resolveUndockBounds(rect(1800, 900, 240, 240), waMain), rect(1680, 800, 240, 240)),
  show(D.resolveUndockBounds(rect(1800, 900, 240, 240), waMain))
);
check(
  '负坐标越界 → 钳回 x=0,y=0',
  eq(D.resolveUndockBounds(rect(-50, -30, 240, 240), waMain), rect(0, 0, 240, 240)),
  show(D.resolveUndockBounds(rect(-50, -30, 240, 240), waMain))
);

console.log('== ④ 多显示器 workArea 计算 ==');
// 副屏在右：x 从 1920 起，宽 1920
const waSecond = rect(1920, 0, 1920, 1040);
const winSecondRight = rect(3600, 400, 240, 240); // 中心 3720 > 2880
check(
  '副屏右半区 → 贴副屏右缘（x = 3830）',
  eq(D.resolveDockBounds(winSecondRight, waSecond, D.resolveDockSide(winSecondRight, waSecond)), rect(3830, 440, 10, 160)),
  show(D.resolveDockBounds(winSecondRight, waSecond, D.resolveDockSide(winSecondRight, waSecond)))
);
const winSecondLeft = rect(2000, 400, 240, 240); // 中心 2120 < 2880
check(
  '副屏左半区 → 贴副屏左缘（x = 1920，不落到主屏）',
  eq(
    D.resolveDockBounds(winSecondLeft, waSecond, D.resolveDockSide(winSecondLeft, waSecond)),
    rect(1920, 440, 10, 160)
  )
);
// 负坐标屏（主屏在右，副屏在左）
const waNegative = rect(-1920, 0, 1920, 1040);
const winNegative = rect(-700, 300, 240, 240); // 中心 -580 > -960
check(
  '负坐标副屏 → 右半区贴 x = -10，判定不依赖 x ≥ 0 假设',
  eq(
    D.resolveDockBounds(winNegative, waNegative, D.resolveDockSide(winNegative, waNegative)),
    rect(-10, 340, 10, 160)
  ),
  show(D.resolveDockBounds(winNegative, waNegative, D.resolveDockSide(winNegative, waNegative)))
);
check(
  '异形/高分屏工作区（2560×1400）→ 贴边与居中按该屏计算',
  eq(D.resolveDockBounds(rect(2000, 300, 240, 240), rect(0, 0, 2560, 1400), 'right'), rect(2550, 340, 10, 160))
);

console.log('== ⑤ 动画：终帧 = 目标值，帧数与时长符合规格 ==');
const fromBounds = rect(1600, 300, 240, 240);
const toBounds = rect(1910, 340, 10, 160);
const frames = C.DOCK_ANIM_FRAMES;
const frameMs = C.DOCK_ANIM_FRAME_MS;

check('ease-out：easeOutCubic(0)=0', D.easeOutCubic(0) === 0);
check('ease-out：easeOutCubic(1)=1', D.easeOutCubic(1) === 1);
check(
  'ease-out：前半段已走完 87.5%（前快后慢，非线性）',
  Math.abs(D.easeOutCubic(0.5) - 0.875) < 1e-9,
  String(D.easeOutCubic(0.5))
);
check('t 越界被夹紧（0/1 之外不放大）', D.easeOutCubic(-1) === 0 && D.easeOutCubic(2) === 1);

check(
  `插值 t=1 严格等于目标 bounds（${show(toBounds)}）`,
  eq(D.interpolateBounds(fromBounds, toBounds, 1), toBounds),
  show(D.interpolateBounds(fromBounds, toBounds, 1))
);

// 模拟 animateWindowBounds 的帧循环：前 frames-1 帧插值，第 frames 帧落精确 target
const trace = [];
for (let i = 1; i <= frames; i += 1) {
  trace.push(
    i >= frames ? { ...toBounds } : D.interpolateBounds(fromBounds, toBounds, i / frames)
  );
}
const last = trace[trace.length - 1];
check(
  `终帧（第 ${frames} 帧）精确等于目标 bounds`,
  eq(last, toBounds),
  show(last)
);
check(
  `帧数 ${frames}、单帧 ${frameMs}ms、总时长 ${frames * frameMs}ms（160–200ms 目标带内且 ≤0.6s）`,
  frames * frameMs >= 160 && frames * frameMs <= 200 && frames * frameMs <= 600
);
check(
  '每帧宽度单调收窄至 10px（边收窄边移动，无回弹）',
  trace.every((b, i) => i === 0 || b.width <= trace[i - 1].width) && last.width === 10
);
check(
  '每帧 x 单调靠向屏幕右缘（1910）',
  trace.every((b, i) => i === 0 || b.x >= trace[i - 1].x) && last.x === 1910
);
check(
  '中间帧不越出「起止矩形」包络（不发生飞出屏幕的抖动）',
  trace.every(
    (b) =>
      b.x >= Math.min(fromBounds.x, toBounds.x) &&
      b.x <= Math.max(fromBounds.x, toBounds.x) &&
      b.y >= Math.min(fromBounds.y, toBounds.y) &&
      b.y <= Math.max(fromBounds.y, toBounds.y)
  )
);

// 展开方向对称：同一组参数反跑也落在原 bounds
const back = [];
for (let i = 1; i <= frames; i += 1) {
  back.push(i >= frames ? { ...fromBounds } : D.interpolateBounds(toBounds, fromBounds, i / frames));
}
check('展开动画终帧 = 收纳前 bounds（对称复用同一插值）', eq(back[back.length - 1], fromBounds));

rmSync(staging, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`断言失败 ${failed} 项`);
  process.exit(1);
}
console.log('全部断言通过');
