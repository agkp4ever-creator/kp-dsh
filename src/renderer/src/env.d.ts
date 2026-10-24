/**
 * 渲染进程全局类型声明：window.pomodoro 白名单 API。
 */
import type { PomodoroApi } from '../../shared/types';

declare global {
  interface Window {
    pomodoro: PomodoroApi;
  }
}

export {};
