/**
 * HistoryChart：近 N 天番茄数柱状图（纯 DOM/CSS，无图表库）。
 * 每天一枚小番茄图标 + 主题色柱，柱高按当日番茄数相对最大值缩放；
 * 入场用 clip-path 揭示，保持“不位移弹跳”的动效约束。
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
  const total = days.reduce((sum, day) => sum + day.completedPomodoros, 0);
  const todayKey = days[days.length - 1]?.date;
  return (
    <div className="history-chart-wrap">
      <div className="history-chart" aria-label={`近 ${days.length} 天番茄数`}>
        {days.map((day, index) => {
          const active = day.completedPomodoros > 0;
          const isToday = day.date === todayKey;
          const height = Math.max(3, Math.round((day.completedPomodoros / max) * BAR_MAX_HEIGHT));
          const delay = `${index * 35}ms`;
          return (
            <div
              key={day.date}
              className={`history-chart__col${active ? ' history-chart__col--active' : ''}${
                isToday ? ' history-chart__col--today' : ''
              }`}
              title={`${day.date} · ${day.completedPomodoros} 个 · ${formatDurationMs(day.focusMs)}`}
            >
              <span
                className={`history-chart__tomato${active ? ' history-chart__tomato--active' : ''}`}
                aria-hidden="true"
                style={{ animationDelay: delay }}
              >
                <svg viewBox="0 0 16 16" focusable="false">
                  <path
                    className="history-chart__tomato-body"
                    d="M8 14.4c-3.2 0-5.6-1.9-5.6-4.9 0-2.8 2.2-4.7 5.6-4.7s5.6 1.9 5.6 4.7c0 3-2.4 4.9-5.6 4.9Z"
                  />
                  <path
                    className="history-chart__tomato-leaf"
                    d="M8 4.7c-.6-1.2-1.7-2-3-2.2.5.8.7 1.6.7 2.3-.9-.2-1.8-.1-2.6.3.8.6 1.7 1 2.7 1.1-.4.4-.6.9-.6 1.4.9-.3 1.8-.4 2.6-.2.8-.2 1.7-.1 2.6.2 0-.5-.2-1-.6-1.4 1-.1 1.9-.5 2.7-1.1-.8-.4-1.7-.5-2.6-.3 0-.7.2-1.5.7-2.3-1.3.2-2.4 1-3 2.2Z"
                  />
                </svg>
              </span>
              <span className="history-chart__value">{day.completedPomodoros}</span>
              <div
                className={`history-chart__bar${active ? '' : ' history-chart__bar--empty'}`}
                style={{ height, animationDelay: delay }}
              />
              <span className="history-chart__label">{day.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <span className="history-chart__hint">
        {total === 0
          ? '开始第一个番茄，这里会长出小番茄'
          : '每根柱 = 当天番茄数 · 悬停看专注时长'}
      </span>
    </div>
  );
}
