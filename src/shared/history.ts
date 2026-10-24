/**
 * 历史统计聚合（纯函数，便于单测）：把按日统计补零成最近 N 天，按日期升序。
 * 用本地日期构造，跨月/跨年由 Date 自动进位；不做时区转换。
 */
import { dateKey } from './format';
import type { DailyStats, HistoryDay, HistoryStats } from './types';

export const HISTORY_DEFAULT_DAYS = 7;
export const HISTORY_MAX_DAYS = 30;

/** 把 days 夹到 1..30 的整数 */
export function clampHistoryDays(days: number): number {
  if (!Number.isFinite(days)) {
    return HISTORY_DEFAULT_DAYS;
  }
  return Math.min(HISTORY_MAX_DAYS, Math.max(1, Math.round(days)));
}

/**
 * @param today 作为区间最后一天（通常 new Date()）
 * @param statsByDate 磁盘上的按日统计
 * @param days 天数（1..30）
 */
export function buildHistory(
  today: Date,
  statsByDate: Record<string, DailyStats>,
  days: number
): HistoryStats {
  const count = clampHistoryDays(days);
  const result: HistoryDay[] = [];
  let totalPomodoros = 0;
  let totalFocusMs = 0;

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = dateKey(day);
    const saved = statsByDate[key];
    const completedPomodoros =
      saved !== undefined && Number.isFinite(saved.completedPomodoros)
        ? Math.max(0, saved.completedPomodoros)
        : 0;
    const focusMs =
      saved !== undefined && Number.isFinite(saved.focusMs) ? Math.max(0, saved.focusMs) : 0;
    result.push({ date: key, completedPomodoros, focusMs });
    totalPomodoros += completedPomodoros;
    totalFocusMs += focusMs;
  }

  return { days: result, totalPomodoros, totalFocusMs };
}
