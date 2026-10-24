/**
 * 纯计时换算（无 Electron 依赖，供 TimerService 与 node 断言共用）。
 *
 * 背景：Skip 过去按 totalMs 计入统计，专注 1 分钟跳过也记 25 分钟；
 * 设置变更也只影响下一次 reset。这里把两处口径收口成可单测的纯函数。
 */
import type { TimerStatus } from './types';

/**
 * 已完成时长 = 总时长 - 剩余时长，并钳制到 [0, totalMs]。
 * 自然到点时 tick 会先把 remainingMs 归零，因此得到满额；
 * 中途 skip 则只结算真实已专注的部分。
 */
export function elapsedMsOf(totalMs: number, remainingMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return 0;
  }
  const remaining = Number.isFinite(remainingMs) ? remainingMs : 0;
  return Math.min(totalMs, Math.max(0, totalMs - remaining));
}

/**
 * 允许的时钟回退阈值：系统对时/NTP 微调通常在毫秒级，只有明显回退才重锚，
 * 避免正常抖动把一次 tick 误判成时钟异常。
 */
export const CLOCK_ROLLBACK_THRESHOLD_MS = 1_000;

export interface ClockRollbackFix {
  /** 重锚后的结束时间戳（保持原剩余时长，而不是被回拨“续命”） */
  endsAt: number;
  remainingMs: number;
  rolledBackMs: number;
}

/**
 * 检测 Date.now() 回拨并重锚计时。
 *
 * 时钟回退时 `endsAt - now` 会凭空变大，表现为计时变慢甚至“倒着走”。
 * 用上一 tick 的单调快照（时刻 + 剩余）判断：回退超过阈值就按回退前剩余
 * 重设 endsAt，让下一次 tick 从正确位置继续。
 *
 * @returns null 表示无需修正（无快照、未超阈值、参数非法）
 */
export function fixClockRollback(
  now: number,
  lastNow: number | null,
  lastRemainingMs: number | null,
  endsAt: number | null,
  thresholdMs: number = CLOCK_ROLLBACK_THRESHOLD_MS
): ClockRollbackFix | null {
  if (lastNow === null || lastRemainingMs === null || endsAt === null) {
    return null;
  }
  if (![now, lastNow, lastRemainingMs, endsAt, thresholdMs].every(Number.isFinite)) {
    return null;
  }
  const rolledBackMs = lastNow - now;
  if (rolledBackMs <= thresholdMs) {
    return null;
  }
  const remainingMs = Math.max(0, lastRemainingMs);
  return { endsAt: now + remainingMs, remainingMs, rolledBackMs };
}

export interface PhaseTime {
  totalMs: number;
  remainingMs: number;
}

/**
 * 设置变更后重算当前阶段时长：
 * - idle：回到新时长的满值（修「空闲态改时长不生效」）
 * - paused：保留已走进度，按新总时长重算剩余（不倒退、不超过满值）
 * - running：返回 null，不打断进行中的阶段，新时长从下一阶段生效
 */
export function reconcilePhaseTime(
  status: TimerStatus,
  totalMs: number,
  remainingMs: number,
  nextTotalMs: number
): PhaseTime | null {
  if (status === 'running' || !Number.isFinite(nextTotalMs) || nextTotalMs <= 0) {
    return null;
  }
  if (status === 'idle') {
    return { totalMs: nextTotalMs, remainingMs: nextTotalMs };
  }
  const elapsed = elapsedMsOf(totalMs, remainingMs);
  return {
    totalMs: nextTotalMs,
    remainingMs: Math.max(0, nextTotalMs - elapsed),
  };
}
