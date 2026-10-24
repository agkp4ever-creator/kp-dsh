/**
 * TimerRing：SVG 细圆环倒计时 + mm:ss + 状态文案。圆环随剩余时间递减。
 * 主进程 tick 已放宽到 1s（降低常驻 CPU），运行态用 requestAnimationFrame
 * 按 endsAt 本地补间，保持 60fps 顺滑；每秒收到权威快照后校正，且不允许倒退。
 */
import { useEffect, useState } from 'react';
import { formatMmSs } from '../../../shared/format';
import type { Phase, RemindEvent, TimerStatus } from '../../../shared/types';

export interface TimerRingProps {
  remainingMs: number;
  totalMs: number;
  /** 本轮预计结束时间戳（epoch ms）；仅 running 时有效，用于本地补间 */
  endsAt: number | null;
  phase: Phase;
  status: TimerStatus;
  remindKind: RemindEvent['kind'] | null;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function captionFor(phase: Phase, status: TimerStatus): string {
  if (phase === 'focus') {
    if (status === 'running') {
      return '专注中';
    }
    if (status === 'paused') {
      return '已暂停';
    }
    return '准备开始';
  }
  if (status === 'running') {
    return '起身远眺';
  }
  if (status === 'paused') {
    return '休息暂停';
  }
  return '休息就绪';
}

export function TimerRing({
  remainingMs,
  totalMs,
  endsAt,
  phase,
  status,
  remindKind,
}: TimerRingProps): JSX.Element {
  const [displayMs, setDisplayMs] = useState(remainingMs);

  useEffect(() => {
    if (status !== 'running' || endsAt === null || totalMs <= 0) {
      setDisplayMs(remainingMs);
      return undefined;
    }
    // 快照到达时以它为准，本地只做「不倒退」的平滑估计
    const estimate = Math.min(totalMs, Math.max(0, remainingMs));
    let frame = 0;
    const tick = (): void => {
      const byWall = endsAt !== null && endsAt > 0 ? endsAt - Date.now() : estimate;
      const next = Math.max(0, Math.min(estimate, byWall));
      setDisplayMs(next);
      if (next > 0) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, endsAt, totalMs, remainingMs]);

  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, displayMs / totalMs)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - ratio);
  const isBreak = phase !== 'focus';
  const ringClass = isBreak ? 'timer-ring--break' : 'timer-ring--focus';
  const remindClass = remindKind !== null ? ' timer-ring--reminding' : '';

  return (
    <div className={`timer-ring ${ringClass}${remindClass}`}>
      <svg className="timer-ring__svg" viewBox="0 0 120 120" width={126} height={126}>
        <circle className="timer-ring__track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="timer-ring__progress"
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="timer-ring__content">
        <div className="timer-ring__time">{formatMmSs(displayMs)}</div>
        <div className="timer-ring__caption">{captionFor(phase, status)}</div>
      </div>
    </div>
  );
}
