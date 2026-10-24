/**
 * 真机 OS 层探针（QA 独立脚本）：验证 Windows 是否真的接受 10×160 的窗口尺寸。
 *
 * 纯几何断言（tests/dock-mode-assert.mjs）只能证明「我们要 10×160」，
 * 不能证明「Windows 给了 10×160」——resizable 切换 + WM_GETMINMAXINFO 的最小轨迹尺寸
 * 可能把宽度钳到 SM_CXMINTRACK。此脚本直接问 Electron 要真实 bounds。
 *
 * 窗口 show:false（不闪窗），独立 userData（不污染用户数据），跑完即退出。
 * 运行：node_modules/electron/dist/electron.exe tests/dock-os-probe.cjs
 */
const { app, BrowserWindow } = require('electron');

const results = [];
function record(name, actual, expected) {
  results.push({ name, actual, expected, pass: actual === expected });
}

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 240,
    height: 240,
    x: 200,
    y: 200,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
  });

  const setAndRead = (target) => {
    win.setBounds(target);
    return win.getBounds();
  };

  // A. 对照：不做 resizable 包裹（工程师注释里描述的旧行为）
  const raw = setAndRead({ x: 300, y: 300, width: 10, height: 160 });
  record('A 裸 setBounds → 10×160（未放开 resizable）', `${raw.width}x${raw.height}`, '10x160');

  // B. 收纳动画路径：setFocusable(false) → setResizable(true) → setBounds → setResizable(false)
  win.setBounds({ x: 300, y: 300, width: 240, height: 240 });
  win.setFocusable(false);
  win.setResizable(true);
  const wrapped = setAndRead({ x: 300, y: 300, width: 10, height: 160 });
  win.setResizable(false);
  record('B 收纳动画包裹序列 → 10×160', `${wrapped.width}x${wrapped.height}`, '10x160');

  // C. 展开回收 240×240（确认能从 10 恢复到 240）
  win.setResizable(true);
  const back = setAndRead({ x: 300, y: 300, width: 240, height: 240 });
  win.setResizable(false);
  record('C 从把手展开回 240×240', `${back.width}x${back.height}`, '240x240');

  // D. 垂直 160 高是否被钳（配合任务栏工作区）
  win.setResizable(true);
  const tall = setAndRead({ x: 300, y: 100, width: 10, height: 160 });
  win.setResizable(false);
  record('D 10×160 竖向把手贴边形态', `${tall.width}x${tall.height}`, '10x160');

  // E. 极窄宽度下的可点击性前提：webContents 是否仍渲染（尺寸非 0）
  const [w, h] = win.getContentSize();
  record('E 内容区尺寸', `${w}x${h}`, '10x160');

  for (const r of results) {
    console.log(`${r.pass ? '[PASS]' : '[FAIL]'} ${r.name} — 实际 ${r.actual}（期望 ${r.expected}）`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`PROBE_SUMMARY total=${results.length} failed=${failed} dpi=${JSON.stringify(
    require('electron').screen.getPrimaryDisplay().workArea
  )}`);
  win.destroy();
  app.exit(failed === 0 ? 0 : 1);
});
