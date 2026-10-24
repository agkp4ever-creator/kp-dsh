/**
 * 数据备份/恢复：导出完整 JSON（设置 + 历史统计），导入时校验并整体替换。
 * 窗口位置不随备份走，导入后保留当前窗口位置，避免挂件突然跳屏。
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dateKey } from '../shared/format';
import type { DataBackupResult, DataRestoreResult, PersistData } from '../shared/types';
import { logger } from './logger';
import { SettingsService } from './settings';
import { StatsService } from './stats';
import { parsePersistData, readPersistData, writePersistData } from './store';

/** 导入文件上限：防止误选大文件把主进程卡死 */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface DataTransferDeps {
  getWindow: () => BrowserWindow | null;
  settingsService: SettingsService;
  statsService: StatsService;
}

export class DataTransferService {
  private readonly deps: DataTransferDeps;

  constructor(deps: DataTransferDeps) {
    this.deps = deps;
  }

  /** 弹出保存对话框并写入当前完整数据；取消返回 null */
  async exportToFile(): Promise<DataBackupResult | null> {
    const options: Electron.SaveDialogOptions = {
      title: '导出番茄钟数据',
      defaultPath: join(app.getPath('documents'), `pomodoro-backup-${dateKey()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const owner = this.deps.getWindow();
    const result =
      owner !== null && !owner.isDestroyed()
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
      return null;
    }
    const text = JSON.stringify(readPersistData(), null, 2);
    writeFileSync(result.filePath, text, 'utf-8');
    logger.info(`data exported to ${result.filePath} bytes=${Buffer.byteLength(text)}`);
    return { path: result.filePath, bytes: Buffer.byteLength(text) };
  }

  /** 弹出打开对话框，校验后覆盖设置与历史统计；取消返回 null */
  async importFromFile(): Promise<DataRestoreResult | null> {
    const options: Electron.OpenDialogOptions = {
      title: '导入番茄钟数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const owner = this.deps.getWindow();
    const result =
      owner !== null && !owner.isDestroyed()
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const file = result.filePaths[0];
    const size = statSync(file).size;
    if (size > MAX_IMPORT_BYTES) {
      throw new Error('备份文件超过 2MB，已拒绝导入');
    }
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    const imported = parsePersistData(parsed);
    if (imported === null) {
      throw new Error('备份文件格式不正确');
    }
    const current = readPersistData();
    const next: PersistData = { ...imported, windowPos: current.windowPos };
    writePersistData(next);
    this.deps.settingsService.replace(next.settings);
    this.deps.statsService.reload();
    logger.info(`data imported from ${file} stats=${Object.keys(next.statsByDate).length}`);
    return { settings: next.settings, statsByDate: next.statsByDate };
  }
}
