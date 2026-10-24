/**
 * StatsBar：今日番茄四点 + 累计专注时长（P0-7）。
 * 线框：今日 ● ● ● ○  专注 2h15m；超过 4 个以数字呈现，不堆图表。
 */
import { formatDurationMs } from '../../../shared/format';
import type { DailyStats } from '../../../shared/types';

export interface StatsBarProps {
  stats: DailyStats;
  /** 当前长休周期内已完成番茄数（P1-4） */
  cyclePomodoros: number;
  /** 长休分档开关（P1-4） */
  tieredBreakEnabled: boolean;
  /** 每 N 个番茄后长休 */
  longBreakEvery: number;
}

const DOT_COUNT = 4;

export function StatsBar({
  stats,
  cyclePomodoros,
  tieredBreakEnabled,
  longBreakEvery,
}: StatsBarProps): JSX.Element {
  const completed = Math.max(0, Math.floor(stats.completedPomodoros));
  const dots = Array.from({ length: DOT_COUNT }, (_unused, index) => index < completed);
  // 本组第几个番茄：已完成数按周期取模，下一个是 +1（P1-4）
  const every = Math.max(1, Math.floor(longBreakEvery));
  const inCycle = cyclePomodoros > 0 ? ((cyclePomodoros - 1) % every) + 1 : 0;

  return (
    <footer className="stats-bar">
      <span className="stats-bar__label">今日</span>
      {completed <= DOT_COUNT ? (
        <span className="stats-bar__dots" aria-label={`今日已完成 ${completed} 个番茄`}>
          {dots.map((filled, index) => (
            <span
              key={index}
              className={filled ? 'stats-bar__dot stats-bar__dot--filled' : 'stats-bar__dot'}
            />
          ))}
        </span>
      ) : (
        <span className="stats-bar__count">{completed} 个</span>
      )}
      <span className="stats-bar__divider" aria-hidden="true" />
      <span className="stats-bar__focus">专注 {formatDurationMs(stats.focusMs)}</span>
      {tieredBreakEnabled && (
        <>
          <span className="stats-bar__divider" aria-hidden="true" />
          <span className="stats-bar__cycle" aria-label={`本组第 ${inCycle} 个番茄`}>
            本组 {inCycle}/{every}
          </span>
        </>
      )}
    </footer>
  );
}
