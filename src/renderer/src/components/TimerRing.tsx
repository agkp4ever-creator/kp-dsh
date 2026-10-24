/**
 * TimerRing：SVG 细圆环倒计时 + mm:ss + 状态文案。圆环随剩余时间递减。
 * 主进程 tick 为 1s，运行态直接按权威快照推进圆环（1fps）。
 * 240px 圆环 1s 仅转 1/1500 圈（<0.25px），肉眼不可见，没必要 60fps 重绘；
 * 窗口隐藏/最小化时暂停补间；快照到达后校正，且不允许倒退。
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
/** 圆环推进间隔：跟随 1s 快照，避免高频 setState 重绘 */
const RING_FRAME_MS = 1000;

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
    const deadline = endsAt;
    // 快照到达时以它为准，本地只做「不倒退」的平滑估计
    const estimate = Math.min(totalMs, Math.max(0, remainingMs));
    let timer: ReturnType<typeof setInterval> | null = null;

    const update = (): void => {
      const byWall = deadline - Date.now();
      const next = Math.max(0, Math.min(estimate, byWall));
      setDisplayMs(next);
      if (next <= 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = (): void => {
      if (timer !== null) {
        return;
      }
      update();
      timer = setInterval(update, RING_FRAME_MS);
    };

    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') {
      start();
    }

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
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
