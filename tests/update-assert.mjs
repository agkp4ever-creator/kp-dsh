/**
 * 自动更新接线断言：通道、类型、preload、IPC、updater 行为、打包配置、脚本齐全。
 * 纯静态读取，不启动 Electron。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf-8');

let passed = 0;
function check(name, condition) {
  if (!condition) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log(`PASS ${name}`);
}

const constants = read('src/shared/constants.ts');
const types = read('src/shared/types.ts');
const preload = read('src/preload/index.ts');
const ipc = read('src/main/ipc.ts');
const updater = read('src/main/updater.ts');
const index = read('src/main/index.ts');
const tray = read('src/main/tray.ts');
const builder = read('electron-builder.yml');
const pkg = JSON.parse(read('package.json'));

for (const channel of ['UPDATE_GET', 'UPDATE_CHECK', 'UPDATE_DOWNLOAD', 'UPDATE_INSTALL', 'UPDATE_STATUS']) {
  check(`constants 定义 ${channel}`, constants.includes(`${channel}:`));
}
check('types 定义 UpdateStatus', types.includes('export interface UpdateStatus'));
check(
  'PomodoroApi.update 暴露 getStatus/check/download/install/onStatus',
  ['getStatus', 'check', 'download', 'install', 'onStatus'].every((name) =>
    types.includes(`update:`) && types.includes(`${name}:`)
  )
);
check('preload 暴露 update 命名空间', preload.includes('update: {'));
check('preload 绑定 UPDATE_STATUS', preload.includes('IpcChannels.UPDATE_STATUS'));
check(
  'ipc 注册 4 个更新 handler',
  ['UPDATE_GET', 'UPDATE_CHECK', 'UPDATE_DOWNLOAD', 'UPDATE_INSTALL'].every((name) =>
    ipc.includes(`IpcChannels.${name}`)
  )
);
check('updater 默认不自动下载', updater.includes('autoDownload = false'));
check('updater 支持 UPDATE_URL 覆盖', updater.includes('UPDATE_URL') && updater.includes('setFeedURL'));
check('updater 安装走 quitAndInstall', updater.includes('quitAndInstall'));
check('updater 开发模式短路', updater.includes('!app.isPackaged'));
check(
  'updater 绿色版无 app-update.yml 时禁用',
  updater.includes('app-update.yml') && updater.includes('绿色版请手动下载新版本覆盖')
);
check(
  'updater 绿色版手动检查也短路',
  (updater.match(/isPortableBuild\(\)/g) ?? []).length >= 2
);
check('updater 延迟检查常量', constants.includes('UPDATE_CHECK_DELAY_MS'));
check('index 组装 UpdaterService', index.includes('new UpdaterService'));
check('index 托盘检查更新接线', index.includes('checkForUpdatesFromTray') && index.includes('checkForUpdates:'));
check('tray 菜单含检查更新', tray.includes('检查更新'));
check(
  '打包配置 GitHub publish',
  builder.includes('provider: github') &&
    builder.includes('owner: agkp4ever-creator') &&
    builder.includes('repo: kp-dsh')
);
check('安装包 ASCII 文件名', builder.includes('pomodoro-widget-setup-${version}.exe'));
check('electron-updater 为运行时依赖', pkg.dependencies?.['electron-updater'] !== undefined);
check('release:win 脚本存在', typeof pkg.scripts?.['release:win'] === 'string');
check('serve:updates 脚本存在', typeof pkg.scripts?.['serve:updates'] === 'string');
check('test:e2e 脚本存在', typeof pkg.scripts?.['test:e2e'] === 'string');

if (process.exitCode === 1) {
  console.error('\nFAIL update-assert');
} else {
  console.log(`\nPASS update-assert（${passed} 项）`);
}
