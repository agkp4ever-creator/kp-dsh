/**
 * useDnd：订阅主进程勿扰状态（手动开关 + 剪辑软件前台自动检测），
 * 挂载时主动拉取一次，避免启动推送早于订阅注册。
 */
import { useEffect, useState } from 'react';
import type { DndState } from '../../../shared/types';

const INITIAL: DndState = { quiet: false, auto: false, detectionAvailable: true };

export function useDnd(): DndState {
  const [state, setState] = useState<DndState>(INITIAL);

  useEffect(() => {
    let pushed = false;
    const unsubscribe = window.pomodoro.dnd.onChanged((next) => {
      pushed = true;
      setState(next);
    });
    void window.pomodoro.dnd.get().then((result) => {
      if (!pushed && result.ok && result.data !== undefined) {
        setState(result.data);
      }
    });
    return unsubscribe;
  }, []);

  return state;
}
