/**
 * QA 负向探针：证明 window-mode-resize-assert.mjs 的 14 项断言不是「宽松假绿」。
 *
 * 两组对抗：
 * 1. Mock 语义对抗：旧序列（裸 setSize）在全部 3 条收缩路径上复现钳制 Bug；
 *    去掉 setResizable(true) 的「回归序列」在 3 条收缩路径上同样收缩失败——
 *    证明若修复被回退，3.2 的 6 条互切断言必然失败。
 * 2. 静态断言 mutation 对抗：对 window.ts 的 applyWindowMode 做 4 种变异
 *    （删 setResizable(true)/换回裸 setSize/调换 setFocusable 顺序/删 setResizable(false)），
 *    逐一验证断言脚本的静态检查会报 FAIL（即断言有牙齿）。
 *
 * 运行：node tests/window-mode-resize-negative-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windowTs = readFileSync(join(root, 'src', 'main', 'window.ts'), 'utf-8');

let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------- 与断言脚本同款 mock（钳制语义逐字一致） ----------
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
      const clamp = (next, cur) => (this.resizable ? next : Math.max(next, cur));
      this.width = clamp(b.width, this.width);
      this.height = clamp(b.height, this.height);
      this.x = b.x;
      this.y = b.y;
    },
    setSize(width, height) {
      this.setBounds({ x: this.x, y: this.y, width, height });
    },
  };
}

const sizes = {
  normal: { width: 240, height: 240 },
  compact: { width: 160, height: 160 },
  settings: { width: 320, height: 420 },
};

function applyModeLegacy(win, mode) {
  const size = sizes[mode];
  win.setSize(size.width, size.height);
  win.setFocusable(mode === 'settings');
}

// 回归序列 = 修复被回退（缺少 setResizable(true) 包裹）
function applyModeRegressed(win, mode) {
  const size = sizes[mode];
  win.setFocusable(mode === 'settings');
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: size.width, height: size.height });
  win.setResizable(false);
}

const shrinkRoutes = [
  ['settings', 'normal'],
  ['settings', 'compact'],
  ['normal', 'compact'],
];

console.log('== 1. Mock 语义对抗：3 条收缩路径 ==');

for (const [from, to] of shrinkRoutes) {
  const win = makeWin(sizes[from].width, sizes[from].height);
  applyModeLegacy(win, to);
  const clamped = win.width === sizes[from].width && win.height === sizes[from].height;
  check(`旧序列 ${from}→${to} 收缩被钳制（复现 Bug）`, clamped, `实际 ${win.width}×${win.height}`);
}

for (const [from, to] of shrinkRoutes) {
  const win = makeWin(sizes[from].width, sizes[from].height);
  applyModeRegressed(win, to);
  const clamped = win.width === sizes[from].width && win.height === sizes[from].height;
  check(
    `回归序列（无 setResizable(true)）${from}→${to} 同样收缩失败 → 3.2 断言必炸`,
    clamped,
    `实际 ${win.width}×${win.height}`
  );
}

console.log('== 2. 静态断言 mutation 对抗：4 种变异必须被检出 ==');

// 复刻断言脚本的静态检查逻辑（indexOf 顺序 + 正则）
function staticChecks(body) {
  const iFocus = body.indexOf('setFocusable');
  const iResTrue = body.indexOf('setResizable(true)');
  const iBounds = body.indexOf('setBounds(');
  const iResFalse = body.indexOf('setResizable(false)');
  return {
    order: iFocus !== -1 && iFocus < iResTrue && iResTrue < iBounds && iBounds < iResFalse,
    boundsShape: /setBounds\(\{\s*x,\s*y,\s*width:\s*size\.width,\s*height:\s*size\.height\s*\}\)/.test(body),
    noSetSize: !body.includes('setSize('),
    restore: iResFalse !== -1,
  };
}

function extractBody(src) {
  const m = src.match(/export function applyWindowMode[\s\S]*?\n\}/);
  return m ? m[0] : '';
}

const originalBody = extractBody(windowTs);
const base = staticChecks(originalBody);
check('原始源码 4 项静态检查全真（基线）', base.order && base.boundsShape && base.noSetSize && base.restore);

const mutations = [
  {
    name: 'M1 删掉 setResizable(true)',
    body: originalBody.replace('  win.setResizable(true);\n', ''),
    expectCaught: (r) => !r.order,
  },
  {
    name: 'M2 setBounds 换回裸 setSize',
    body: originalBody.replace(
      'win.setBounds({ x, y, width: size.width, height: size.height });',
      'win.setSize(size.width, size.height);'
    ),
    expectCaught: (r) => !r.noSetSize || !r.boundsShape,
  },
  {
    name: 'M3 setFocusable 挪到 setBounds 之后',
    body: originalBody
      .replace('  win.setFocusable(mode === \'settings\');\n', '')
      .replace(
        'win.setBounds({ x, y, width: size.width, height: size.height });',
        'win.setBounds({ x, y, width: size.width, height: size.height });\n  win.setFocusable(mode === \'settings\');'
      ),
    expectCaught: (r) => !r.order,
  },
  {
    name: 'M4 删掉 setResizable(false) 还原',
    body: originalBody.replace('  win.setResizable(false);\n', ''),
    expectCaught: (r) => !r.restore || !r.order,
  },
];

for (const mut of mutations) {
  const result = staticChecks(mut.body);
  check(`${mut.name} 被静态断言检出`, mut.expectCaught(result), JSON.stringify(result));
}

console.log('');
if (failed > 0) {
  console.error(`负向探针失败 ${failed} 项（说明断言套件存在假绿风险）`);
  process.exit(1);
}
console.log('负向探针全部通过：断言套件对 4 种变异 + 3 条收缩回归均有检出能力');
