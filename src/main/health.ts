/**
 * HealthReminderService：P1-1 20-20-20 护眼提醒 + P1-2 久坐起身提醒。
 * timestamp 驱动（与 TimerService 同思路，抗睡眠漂移）；间隔可配、可开关。
 * 提醒经 onRemind 上报，由组装层与番茄到点提醒合并（防双音轰炸）。
 */
import { HEALTH_TICK_MS, MINUTE_MS } from '../shared/constants';
import type { RemindKind, Settings } from '../shared/types';
import { logger } from './logger';

export interface HealthReminderDeps {
  getSettings: () => Settings;
  /** 上报健康提醒（组装层负责合并去重） */
  onRemind: (kind: RemindKind) => void;
}

export class HealthReminderService {
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastEyeCareAt: number = Date.now();
  private lastSedentaryAt: number = Date.now();
  private readonly deps: HealthReminderDeps;

  constructor(deps: HealthReminderDeps) {
    this.deps = deps;
    this.tickHandle = setInterval(() => this.tick(), HEALTH_TICK_MS);
    logger.info('health reminder service started');
  }

  /** 系统睡眠唤醒后补算 */
  nudge(): void {
    this.tick();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private tick(): void {
    const settings = this.deps.getSettings();
    const now = Date.now();

    if (settings.eyeCareEnabled) {
      const intervalMs = settings.eyeCareIntervalMinutes * MINUTE_MS;
      if (now - this.lastEyeCareAt >= intervalMs) {
        this.lastEyeCareAt = now;
        this.deps.onRemind('eyeCare');
        logger.info('eye care reminder fired');
      }
    } else {
      // 关闭期间不积累欠账：重新计时
      this.lastEyeCareAt = now;
    }

    if (settings.sedentaryEnabled) {
      const intervalMs = settings.sedentaryIntervalMinutes * MINUTE_MS;
      if (now - this.lastSedentaryAt >= intervalMs) {
        this.lastSedentaryAt = now;
        this.deps.onRemind('sedentary');
        logger.info('sedentary reminder fired');
      }
    } else {
      this.lastSedentaryAt = now;
    }
  }
}
