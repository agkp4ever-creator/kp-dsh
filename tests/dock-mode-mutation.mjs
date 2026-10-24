/**
 * Mutation 对抗测试（QA 独立编写，不改 src 源码）。
 *
 * 目的：验证 tests/dock-mode-assert.mjs 的断言「真有杀伤力」——
 * 在沙箱副本里注入典型实现错误，断言套件必须变红（exit 1）。
 * 若某变异仍然全绿，说明断言存在盲区（假通过）。
 *
 * 沙箱：把 src/shared/{constants,dock}.ts、src/main/window.ts、
 * src/renderer/src/components/TitleBar.tsx 与断言脚本复制到临时目录，
 * 断言脚本以自身路径定位 root，因此天然读取副本。
 *
 * 运行：node tests/dock-mode-mutation.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  ['src/shared/constants.ts', 'src/shared/constants.ts'],
  ['src/shared/dock.ts', 'src/shared/dock.ts'],
  ['src/main/window.ts', 'src/main/window.ts'],
  ['src/renderer/src/components/TitleBar.tsx', 'src/renderer/src/components/TitleBar.tsx'],
  ['tests/dock-mode-assert.mjs', 'tests/dock-mode-assert.mjs'],
];

/** 每个变异：文件名 + 原文 + 替换文（原文必须命中，否则变异本身失效） */
const mutations = [
  {
    id: 'M1 把手宽度 10 → 12',
    file: 'src/shared/constants.ts',
    from: 'export const DOCK_HANDLE_WIDTH = 10;',
    to: 'export const DOCK_HANDLE_WIDTH = 12;',
  },
  {
    id: 'M2 去掉垂直钳制（居中越界不管）',
    file: 'src/shared/dock.ts',
    from: `  const y = clamp(
    centeredY,
    workArea.y,
    workArea.y + workArea.height - DOCK_HANDLE_HEIGHT
  );`,
    to: '  const y = centeredY;',
  },
  {
    id: 'M3 左右判定符号反转（< → >=）',
    file: 'src/shared/dock.ts',
    from: "return windowCenterX < workAreaCenterX ? 'left' : 'right';",
    to: "return windowCenterX >= workAreaCenterX ? 'left' : 'right';",
  },
  {
    id: 'M4 动画帧数 10 → 8（跌破 10–12 规格）',
    file: 'src/shared/constants.ts',
    from: 'export const DOCK_ANIM_FRAMES = 10;',
    to: 'export const DOCK_ANIM_FRAMES = 8;',
  },
  {
    id: 'M5 ease-out 退化为线性',
    file: 'src/shared/dock.ts',
    from: '  return 1 - Math.pow(1 - p, 3);',
    to: '  return p;',
  },
  {
    id: 'M6 动画去掉 setResizable(true)（收缩被系统钳制，原 Bug 复现）',
    file: 'src/main/window.ts',
    from: `  win.setFocusable(false);
  win.setResizable(true);

  let frame = 0;`,
    to: `  win.setFocusable(false);

  let frame = 0;`,
  },
  {
    id: 'M7 终帧不落精确 target（改用插值末帧）',
    file: 'src/main/window.ts',
    from: '      win.setBounds(target);',
    to: '      win.setBounds(interpolateBounds(from, target, (frame - 1) / DOCK_ANIM_FRAMES));',
  },
  {
    id: 'M8 移除 persistWindowPos 抑制守卫（位置记忆被把手覆盖）',
    file: 'src/main/window.ts',
    from: `  if (isMoveSuppressed()) {
    return;
  }
  try {
    const [x, y] = win.getPosition();`,
    to: `  try {
    const [x, y] = win.getPosition();`,
  },
];

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'pomodoro-dock-mut-'));
  for (const [from] of FILES) {
    cpSync(join(root, from), join(dir, from));
  }
  return dir;
}

function run(dir) {
  const res = spawnSync(process.execPath, [join(dir, 'tests', 'dock-mode-assert.mjs')], {
    cwd: dir,
    encoding: 'utf-8',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const fails = out
    .split('\n')
    .filter((line) => line.includes('[FAIL]'))
    .map((line) => line.trim().replace(/^\[FAIL\]\s*/, ''));
  const passCount = out.split('\n').filter((line) => line.includes('[PASS]')).length;
  return { code: res.status, fails, passCount };
}

console.log('== 基线：沙箱未变异，应 41/41 全绿 ==');
const baseDir = sandbox();
const base = run(baseDir);
console.log(
  `  基线 pass=${base.passCount} fail=${base.fails.length} exit=${base.code} => ${
    base.code === 0 && base.fails.length === 0 && base.passCount === 41 ? 'OK' : '异常'
  }`
);
rmSync(baseDir, { recursive: true, force: true });
const baseOk = base.code === 0 && base.fails.length === 0 && base.passCount === 41;

let missed = 0;
const rows = [];
for (const m of mutations) {
  const dir = sandbox();
  const path = join(dir, m.file);
  const original = readFileSync(path, 'utf-8');
  if (!original.includes(m.from)) {
    console.error(`  [被测变异失效] ${m.id} — 原文未命中 ${m.file}`);
    missed += 1;
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, original.replace(m.from, m.to), 'utf-8');
  const res = run(dir);
  const killed = res.code === 1 && res.fails.length > 0;
  rows.push({ id: m.id, killed, fails: res.fails, pass: res.passCount });
  console.log(
    `  ${killed ? '[KILLED]' : '[SURVIVED]'} ${m.id} — 失败 ${res.fails.length} 项 / 通过 ${res.passCount}`
  );
  for (const f of res.fails) {
    console.log(`      ↳ ${f}`);
  }
  if (!killed) {
    missed += 1;
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(`变异总数 ${mutations.length}，被杀死 ${rows.filter((r) => r.killed).length}，存活 ${missed}`);
if (!baseOk || missed > 0) {
  console.error('MUTATION 结论：存在盲区或基线异常');
  process.exit(1);
}
console.log('MUTATION 结论：全部变异被检出（断言具备杀伤力）');
