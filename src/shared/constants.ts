/**
 * 共享常量：IPC 通道、默认设置、窗口尺寸、状态机节奏、测试钩子环境变量名。
 * IPC 通道字符串只允许出现在本文件（架构 §7）。
 */
import type { Settings, TimerCommand, TimerState, WindowMode } from './types';

export const IpcChannels = {
  TIMER_COMMAND: 'timer:command',
  TIMER_GET: 'timer:get',
  TIMER_STATE: 'timer:state',
  REMIND: 'remind',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_CHANGED: 'settings:changed',
  STATS_GET: 'stats:get',
  STATS_CHANGED: 'stats:changed',
  WINDOW_SET_MODE: 'window:setMode',
  WINDOW_MODE_CHANGED: 'window:mode',
  WINDOW_DOCK: 'window:dock',
  WINDOW_UNDOCK: 'window:undock',
  WINDOW_DOCKED: 'window:docked',
  THEME_GET: 'theme:get',
  THEME_SCHEME: 'theme:scheme',
  DND_GET: 'dnd:get',
  DND_STATE: 'dnd:state',
  UPDATE_GET: 'update:get',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
  APP_QUIT: 'app:quit',
} as const;

export const TIMER_COMMANDS: readonly TimerCommand[] = ['start', 'pause', 'reset', 'skip'];

export const WINDOW_MODES: readonly WindowMode[] = ['normal', 'compact', 'settings'];

/** 状态机 tick 周期（毫秒）：1s 足够驱动秒级文本，圆环由渲染层 rAF 补间 */
export const TICK_INTERVAL_MS = 1000;

/** 健康提醒轮询周期（毫秒） */
export const HEALTH_TICK_MS = 1000;

/** 到点提醒合并窗口（毫秒）：窗口内多类提醒只发一条（防双音轰炸） */
export const REMIND_MERGE_MS = 250;

/** 安装版启动后静默检查更新的延迟（毫秒）：错开启动高峰，不阻塞挂件显示 */
export const UPDATE_CHECK_DELAY_MS = 15_000;

/** 渲染进程 unresponsive 宽限（毫秒）：超时仍无响应则强制崩溃并走重建 */
export const UNRESPONSIVE_GRACE_MS = 5_000;

export const MINUTE_MS = 60_000;

/** 窗口三模式尺寸（PRD §5.1：normal 240×240 / compact 160×160 / settings 320×420） */
export const WINDOW_SIZES: Record<WindowMode, { width: number; height: number }> = {
  normal: { width: 240, height: 240 },
  compact: { width: 160, height: 160 },
  settings: { width: 320, height: 420 },
};

/** 默认窗口尺寸 = normal（兼容既有引用） */
export const WINDOW_SIZE = WINDOW_SIZES.normal;

/** 贴边吸附阈值（px，P1-5） */
export const EDGE_SNAP_PX = 12;

/** 默认位置距屏幕边缘（px，PRD §5.1 右下角 24px） */
export const DEFAULT_EDGE_MARGIN = 24;

/** 收纳把手尺寸（P1-7 方案 B）：竖向细条，贴屏幕左/右边缘 */
export const DOCK_HANDLE_WIDTH = 10;
export const DOCK_HANDLE_HEIGHT = 160;

/** 收纳/展开动画：10 帧 × 16ms ≈ 160ms（ease-out） */
export const DOCK_ANIM_FRAMES = 10;
export const DOCK_ANIM_FRAME_MS = 16;

/**
 * 紧凑（“最小化”）模式整体不透明度：240↔160 尺寸动画结束后压暗到 62%，
 * 提示“已收起”，同时保留内容可读性；normal/settings 恢复 100%。
 */
export const WINDOW_COMPACT_OPACITY = 0.62;

export const APP_TITLE = '番茄钟挂件';

/** 默认设置（PRD v0.2.1：focus 25 / 短休 5 / 长休 60 / 自启 true / theme minimal） */
export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 60,
  tieredBreakEnabled: false,
  longBreakEvery: 4,
  volume: 60,
  muted: false,
  autoStartAtLogin: true,
  theme: 'minimal',
  showEyeCareTip: true,
  eyeCareEnabled: true,
  eyeCareIntervalMinutes: 20,
  sedentaryEnabled: true,
  sedentaryIntervalMinutes: 45,
  dndMode: false,
};

/** QA 测试钩子：覆盖阶段时长（毫秒），未设置时按 settings 分钟数 */
export const ENV_FOCUS_MS = 'POMODORO_FOCUS_MS';
export const ENV_BREAK_MS = 'POMODORO_BREAK_MS';

/** 计时器初始状态（聚焦阶段、未启动、满值） */
export function createInitialTimerState(totalMs: number): TimerState {
  return {
    phase: 'focus',
    status: 'idle',
    remainingMs: totalMs,
    totalMs,
    endsAt: null,
    cyclePomodoros: 0,
  };
}
