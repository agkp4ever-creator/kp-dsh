/**
 * useTimer：订阅主进程 timer:state 推送，转发计时命令。
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, MINUTE_MS } from '../../../shared/constants';
import type { TimerCommand, TimerState } from '../../../shared/types';

const INITIAL_STATE: TimerState = {
  phase: 'focus',
  status: 'idle',
  remainingMs: DEFAULT_SETTINGS.focusMinutes * MINUTE_MS,
  totalMs: DEFAULT_SETTINGS.focusMinutes * MINUTE_MS,
  endsAt: null,
  cyclePomodoros: 0,
};

export interface UseTimerResult {
  state: TimerState;
  send: (command: TimerCommand) => void;
}

export function useTimer(): UseTimerResult {
  const [state, setState] = useState<TimerState>(INITIAL_STATE);

  useEffect(() => {
    let pushed = false;
    const unsubscribe = window.pomodoro.timer.onState((next) => {
      pushed = true;
      setState(next);
    });
    // 补订阅竞态：主进程可能在监听注册前就已推送（启动/刷新/空闲态改时长）
    void window.pomodoro.timer.get().then((result) => {
      if (!pushed && result.ok && result.data !== undefined) {
        setState(result.data);
      }
    });
    return unsubscribe;
  }, []);

  const send = useCallback((command: TimerCommand) => {
    void window.pomodoro.timer.command(command);
  }, []);

  return { state, send };
}
