/**
 * ControlBar：开始 / 暂停 / 继续 / 重置 / 跳过 / 开始下一个番茄。
 * 休息进行中主按钮=「开始下一个番茄」（skip 休息 + 立即开始，对应 PRD §5.3 CTA）。
 */
import { useCallback } from 'react';
import type { TimerCommand, TimerState } from '../../../shared/types';

export interface ControlBarProps {
  state: TimerState;
  onCommand: (command: TimerCommand) => void;
}

export function ControlBar({ state, onCommand }: ControlBarProps): JSX.Element {
  const { status, phase, cyclePomodoros } = state;
  const isBreak = phase !== 'focus';

  // 休息中一键进入下一番茄：跳过剩余休息 + 立即开始
  const handleStartNext = useCallback(() => {
    onCommand('skip');
    onCommand('start');
  }, [onCommand]);

  if (status === 'running') {
    return (
      <div className="control-bar">
        <button type="button" className="btn" onClick={() => onCommand('pause')}>
          暂停
        </button>
        {isBreak ? (
          <button type="button" className="btn btn--primary" onClick={handleStartNext}>
            开始下一个番茄
          </button>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => onCommand('skip')}>
            跳过
          </button>
        )}
      </div>
    );
  }

  if (status === 'paused') {
    return (
      <div className="control-bar">
        <button type="button" className="btn btn--primary" onClick={() => onCommand('start')}>
          继续
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => onCommand('reset')}>
          重置
        </button>
      </div>
    );
  }

  // idle：休息结束后进入 focus(idle) 且已有番茄记录 -> 「开始下一个番茄」
  const showNextPomodoro = phase === 'focus' && cyclePomodoros > 0;
  return (
    <div className="control-bar">
      <button
        type="button"
        className="btn btn--primary btn--wide"
        onClick={() => onCommand('start')}
      >
        {showNextPomodoro ? '开始下一个番茄' : '开始'}
      </button>
    </div>
  );
}
