/**
 * HistoryChart：近 N 天番茄数柱状图（纯 DOM/CSS，无图表库）。
 * 柱高按当日番茄数相对最大值缩放，悬停显示日期/数量/专注时长。
 */
import { formatDurationMs } from '../../../shared/format';
import type { HistoryDay } from '../../../shared/types';

export interface HistoryChartProps {
  days: HistoryDay[];
}

const BAR_MAX_HEIGHT = 34;

export function HistoryChart({ days }: HistoryChartProps): JSX.Element {
  if (days.length === 0) {
    return <div className="history-chart history-chart--empty">暂无记录</div>;
  }
  const max = Math.max(1, ...days.map((day) => day.completedPomodoros));
  return (
    <div className="history-chart" aria-label="近 7 天番茄数">
      {days.map((day) => {
        const height = Math.max(3, Math.round((day.completedPomodoros / max) * BAR_MAX_HEIGHT));
        return (
          <div
            key={day.date}
            className="history-chart__col"
            title={`${day.date} · ${day.completedPomodoros} 个 · ${formatDurationMs(day.focusMs)}`}
          >
            <span className="history-chart__value">{day.completedPomodoros}</span>
            <div className="history-chart__bar" style={{ height }} />
            <span className="history-chart__label">{day.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}
