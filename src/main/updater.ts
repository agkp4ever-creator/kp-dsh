/**
 * 自动更新：electron-updater + generic 静态源。
 * - 安装版（NSIS）启动 15s 后静默检查一次，不自动下载；
 * - 设置页可手动检查 / 下载 / 重启安装；
 * - 开发模式（app.isPackaged=false）直接 idle，不发起网络请求；
 * - UPDATE_URL 环境变量可覆盖打包时写入的默认更新源，便于本地验证。
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UPDATE_CHECK_DELAY_MS } from '../shared/constants';
import type { UpdateStatus } from '../shared/types';
import { logger } from './logger';

export interface UpdaterDeps {
  /** 状态变化推送到渲染层（窗口不在时静默丢弃） */
  onStatus: (status: UpdateStatus) => void;
}

export class UpdaterService {
  private status: UpdateStatus;
  private initialized = false;
  private readonly deps: UpdaterDeps;

  constructor(deps: UpdaterDeps) {
    this.deps = deps;
    this.status = { state: 'idle', currentVersion: app.getVersion() };
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  /** 绑定事件并安排首次静默检查（幂等） */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!app.isPackaged) {
      this.setStatus({ state: 'idle', message: '开发模式不检查更新' });
      return;
    }

    // 绿色版没有 electron-builder 写入的 app-update.yml：不发起网络检查，提示手动覆盖
    if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
      this.setStatus({ state: 'idle', message: '绿色版请手动下载新版本覆盖' });
      logger.info('app-update.yml missing, updater disabled (portable build)');
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.setStatus({ state: 'checking', message: '正在检查更新…' });
    });
    autoUpdater.on('update-available', (info) => {
      logger.info(`update available: ${info.version}`);
      this.setStatus({ state: 'available', version: info.version, message: '发现新版本' });
    });
    autoUpdater.on('update-not-available', (info) => {
      logger.info(`update not available: ${info.version}`);
      this.setStatus({ state: 'not-available', version: info.version, message: '已是最新版本' });
    });
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({
        state: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        message: '正在下载更新…',
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`update downloaded: ${info.version}`);
      this.setStatus({ state: 'downloaded', version: info.version, message: '更新已下载，重启后安装' });
    });
    autoUpdater.on('error', (err) => {
      logger.error('updater error', err);
      this.setStatus({ state: 'error', message: err.message });
    });

    const feedUrl = process.env.UPDATE_URL?.trim();
    if (feedUrl) {
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
        logger.info(`update feed overridden: ${feedUrl}`);
      } catch (err) {
        logger.error('set update feed failed', err);
      }
    }

    const timer = setTimeout(() => {
      void this.check(false);
    }, UPDATE_CHECK_DELAY_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: 'idle', message: '开发模式不检查更新' });
      return this.getStatus();
    }
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.getStatus();
    }
    this.setStatus({ state: 'checking', message: '正在检查更新…', percent: undefined });
    try {
      await autoUpdater.checkForUpdates();
      logger.info(`update check requested (manual=${String(manual)})`);
    } catch (err) {
      logger.error('update check failed', err);
      this.setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return this.getStatus();
  }

  async download(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      return this.getStatus();
    }
    if (this.status.state !== 'available' && this.status.state !== 'downloading') {
      return this.getStatus();
    }
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      logger.error('update download failed', err);
      this.setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return this.getStatus();
  }

  /** 仅下载完成后可调用；静默安装并自动重启，避免更新时再点安装向导 */
  install(): void {
    if (this.status.state !== 'downloaded') {
      return;
    }
    logger.info('quit and install update (silent)');
    autoUpdater.quitAndInstall(true, true);
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() };
    this.deps.onStatus(this.getStatus());
  }
}
