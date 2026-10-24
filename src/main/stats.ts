/**
 * StatsService：今日番茄数/专注时长累计与落盘（P0-7）。
 * 按本地日期滚动；持久化经 store 读-改-写 statsByDate。
 */
import { dateKey } from '../shared/format';
import type { DailyStats } from '../shared/types';
import { logger } from './logger';
import { readPersistData, writePersistData } from './store';

type StatsListener = (stats: DailyStats) => void;

function emptyOf(date: string): DailyStats {
  return { date, completedPomodoros: 0, focusMs: 0 };
}

export class StatsService {
  private today: DailyStats = emptyOf(dateKey());
  private readonly listeners: StatsListener[] = [];

  /** 从磁盘加载今日统计（缺失则从零开始） */
  load(): DailyStats {
    const data = readPersistData();
    const key = dateKey();
    const saved = data.statsByDate[key];
    this.today =
      saved !== undefined
        ? {
            date: key,
            completedPomodoros: Math.max(0, saved.completedPomodoros),
            focusMs: Math.max(0, saved.focusMs),
          }
        : emptyOf(key);
    logger.info(`stats loaded date=${key} pomodoros=${this.today.completedPomodoros}`);
    return this.getToday();
  }

  /** 跨日后首次访问自动滚动到新的一天 */
  getToday(): DailyStats {
    return this.ensureToday();
  }

  /** 完成一个番茄 +1 */
  addPomodoro(): DailyStats {
    const current = this.ensureToday();
    this.today = { ...current, completedPomodoros: current.completedPomodoros + 1 };
    this.persist();
    this.notify();
    return this.getToday();
  }

  /** 累计专注毫秒 */
  addFocusMs(ms: number): DailyStats {
    const current = this.ensureToday();
    const delta = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
    this.today = { ...current, focusMs: current.focusMs + delta };
    this.persist();
    this.notify();
    return this.getToday();
  }

  onChange(listener: StatsListener): void {
    this.listeners.push(listener);
  }

  private ensureToday(): DailyStats {
    const key = dateKey();
    if (this.today.date !== key) {
      this.today = emptyOf(key);
    }
    return { ...this.today };
  }

  private persist(): void {
    try {
      const data = readPersistData();
      data.statsByDate[this.today.date] = this.getToday();
      writePersistData(data);
    } catch (err) {
      logger.error('persist stats failed', err);
    }
  }

  private notify(): void {
    const snapshot = this.getToday();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.error('stats listener failed', err);
      }
    }
  }
}
