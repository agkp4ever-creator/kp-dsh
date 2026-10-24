/**
 * Windows 发布：构建渲染层/主进程 → NSIS 安装包 → 校验 latest.yml 与安装包。
 * 用法：node scripts/release.mjs
 * 产物在 release/，把 latest.yml + setup exe 一起上传到 publish.url 指向的静态目录。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: '0' };

function run(script, args) {
  console.log(`\n$ node ${script} ${args.join(' ')}`);
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', env });
}

run('node_modules/electron-vite/bin/electron-vite.js', ['build']);
run('node_modules/electron-builder/cli.js', ['--win']);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const latest = join(root, 'release', 'latest.yml');
const setup = join(root, 'release', `pomodoro-widget-setup-${pkg.version}.exe`);
const updateConfig = join(root, 'release', 'win-unpacked', 'resources', 'app-update.yml');

const missing = [latest, setup, updateConfig].filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(`\n发布产物缺失：\n${missing.map((file) => `  - ${file}`).join('\n')}`);
  process.exit(1);
}

const mb = (file) => (statSync(file).size / 1024 / 1024).toFixed(1);
console.log('\n发布产物：');
console.log(`  latest.yml        ${latest}`);
console.log(`  安装包            ${setup} (${mb(setup)} MB)`);
console.log(`  更新配置          ${updateConfig}`);
console.log('\n把 latest.yml 与安装包上传到 publish.url 指向的静态目录即可。');
