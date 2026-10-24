/**
 * useStats：启动拉取 stats:get，订阅 stats:changed 推送。
 */
import { useEffect, useState } from 'react';
import { dateKey } from '../../../shared/format';
import type { DailyStats } from '../../../shared/types';

const INITIAL_STATS: DailyStats = {
  date: dateKey(),
  completedPomodoros: 0,
  focusMs: 0,
};

export interface UseStatsResult {
  stats: DailyStats;
}

export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<DailyStats>(INITIAL_STATS);

  useEffect(() => {
    let disposed = false;
    void window.pomodoro.stats.get().then((result) => {
      if (!disposed && result.ok && result.data) {
        setStats(result.data);
      }
    });
    const unsubscribe = window.pomodoro.stats.onChanged((next) => {
      setStats(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return { stats };
}
