/**
 * SettingsService：设置读写、变更广播。持久化经 store 读-改-写。
 */
import type { Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { logger } from './logger';
import { readPersistData, sanitizeSettings, writePersistData } from './store';

type SettingsListener = (settings: Settings) => void;

export class SettingsService {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners: SettingsListener[] = [];

  /** 从磁盘加载（缺失/损坏回退默认值） */
  load(): Settings {
    const data = readPersistData();
    this.current = sanitizeSettings(
      { ...(data.settings as unknown as Record<string, unknown>) },
      DEFAULT_SETTINGS
    );
    logger.info('settings loaded');
    return this.get();
  }

  get(): Settings {
    return { ...this.current };
  }

  /** 局部更新：仅接受合法字段，落盘并广播 */
  update(patch: Partial<Settings>): Settings {
    this.current = sanitizeSettings(patch as Record<string, unknown>, this.current);
    this.persist();
    this.notify();
    return this.get();
  }

  /** 整体替换（导入备份用）：所有字段经白名单校验，落盘并广播 */
  replace(next: Settings): Settings {
    this.current = sanitizeSettings(next as unknown as Record<string, unknown>, DEFAULT_SETTINGS);
    this.persist();
    this.notify();
    return this.get();
  }

  onChange(listener: SettingsListener): void {
    this.listeners.push(listener);
  }

  private persist(): void {
    try {
      const data = readPersistData();
      data.settings = this.current;
      writePersistData(data);
    } catch (err) {
      logger.error('persist settings failed', err);
    }
  }

  private notify(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.error('settings listener failed', err);
      }
    }
  }
}
