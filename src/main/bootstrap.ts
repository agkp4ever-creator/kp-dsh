/**
 * 启动早期覆写 userData，必须早于任何持久化服务（settings/stats/logger）构造。
 * E2E 测试用 POMODORO_USER_DATA_DIR 指向临时目录：既隔离用户真实配置，
 * 也让单实例锁基于独立目录，避免与用户正在运行的挂件互斥。
 */
import { app } from 'electron';
import { mkdirSync } from 'fs';

const override = process.env.POMODORO_USER_DATA_DIR;
if (override !== undefined && override.trim() !== '') {
  mkdirSync(override, { recursive: true });
  app.setPath('userData', override);
}
