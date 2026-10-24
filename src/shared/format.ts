/**
 * 时间/日期格式化工具（共享层）。
 */

/**
 * 将毫秒格式化为 `mm:ss`（分钟可超过 59，如 60 分钟 -> "60:00"）。
 * 剩余时间按向上取整显示，保证 25 分整点显示 "25:00"。
 */
export function formatMmSs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * 将毫秒格式化为紧凑时长 `XhYYm` / `Ym`（统计展示用，如 2h15m）。
 */
export function formatDurationMs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalMinutes = Math.floor(safeMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h${pad2(minutes)}m`;
  }
  return `${minutes}m`;
}

/**
 * 本地日期键 `YYYY-MM-DD`（统计按日滚动，架构 §7）。
 */
export function dateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
