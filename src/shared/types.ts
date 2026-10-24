/**
 * 跨进程共享类型定义（架构 §3.1，P1 扩展按 §8 R4 收口）。
 * 标识符英文；此处仅类型，无运行时依赖。
 */

// ---------- 状态机 ----------
export type Phase = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type WindowMode = 'normal' | 'compact' | 'settings';

export interface TimerState {
  phase: Phase;
  status: TimerStatus;
  remainingMs: number;
  totalMs: number;
  endsAt: number | null;
  cyclePomodoros: number;
}

// ---------- 收纳态（P1-7 方案 B：手动收纳到屏幕侧边） ----------
/**
 * 收纳态与 WindowMode 正交：不新增模式枚举值，仅由主进程维护运行态。
 * 重启不记忆（始终 normal 启动）。
 */
export type DockSide = 'left' | 'right';

export interface DockState {
  docked: boolean;
  side: DockSide;
}

// ---------- 主题（P1-3） ----------
/**
 * 配色族：minimal=极简黑白（锁定深色）；tomato/forest/ocean/lavender=主题色（随系统明暗）；
 * system=跟随系统（极简风格 + 系统深浅色）。
 */
export const THEME_NAMES = ['minimal', 'tomato', 'forest', 'ocean', 'lavender', 'system'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export type ThemeScheme = 'light' | 'dark';

// ---------- 设置 ----------
export interface Settings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  tieredBreakEnabled: boolean;
  longBreakEvery: number;
  volume: number;
  muted: boolean;
  autoStartAtLogin: boolean;
  theme: ThemeName;
  showEyeCareTip: boolean;
  /** P1-1 20-20-20 护眼提醒开关（默认开） */
  eyeCareEnabled: boolean;
  /** P1-1 护眼提醒间隔（分钟，默认 20） */
  eyeCareIntervalMinutes: number;
  /** P1-2 久坐起身提醒开关（默认开） */
  sedentaryEnabled: boolean;
  /** P1-2 久坐提醒间隔（分钟，默认 45） */
  sedentaryIntervalMinutes: number;
  /** P1-6 手动勿扰（提醒仅视觉，不发声） */
  dndMode: boolean;
}

// ---------- 今日统计 ----------
export interface DailyStats {
  date: string;
  completedPomodoros: number;
  focusMs: number;
}

// ---------- 历史统计（近 N 天，按日期升序，含今天） ----------
export type HistoryDay = DailyStats;

export interface HistoryStats {
  days: HistoryDay[];
  totalPomodoros: number;
  totalFocusMs: number;
}

// ---------- 数据备份/恢复 ----------
export interface DataBackupResult {
  path: string;
  bytes: number;
}

export interface DataRestoreResult {
  settings: Settings;
  statsByDate: Record<string, DailyStats>;
}

// ---------- 持久化文件 ----------
export interface PersistData {
  settings: Settings;
  statsByDate: Record<string, DailyStats>;
  windowPos: { x: number; y: number } | null;
}

// ---------- 提醒事件（P1-1 扩展 kind；合并批次 + 勿扰标记） ----------
export type RemindKind = 'focusEnd' | 'breakEnd' | 'eyeCare' | 'sedentary';

export interface RemindEvent {
  /** 主提示类型（决定音色；合并批次取优先级最高者） */
  kind: RemindKind;
  /** 本次合并批次内的全部提醒（防双音：同时触发只发一条事件） */
  kinds: RemindKind[];
  /** 勿扰中：仅视觉，不发声 */
  quiet: boolean;
}

// ---------- 勿扰状态（P1-6：手动开关 + 剪辑软件前台自动检测） ----------
export interface DndState {
  /** 当前是否勿扰（手动 dndMode 或自动命中） */
  quiet: boolean;
  /** 自动检测命中剪辑软件前台（用于 UI 区分「自动勿扰」与「手动勿扰」） */
  auto: boolean;
  /** 自动检测是否可用（false = 已降级为仅手动开关） */
  detectionAvailable: boolean;
}

// ---------- 自动更新（发布链路） ----------
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  /** 目标版本号（available / downloading / downloaded / not-available 时有值） */
  version?: string;
  /** 下载进度 0-100 */
  percent?: number;
  /** 状态说明（开发模式、错误信息等） */
  message?: string;
}

// ---------- IPC 载荷 ----------
export type TimerCommand = 'start' | 'pause' | 'reset' | 'skip';

export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ---------- 预加载暴露的白名单 API ----------
export type Unsubscribe = () => void;

export interface PomodoroApi {
  timer: {
    command: (command: TimerCommand) => Promise<IpcResult<TimerState>>;
    /** 主动拉取权威状态（启动/刷新时补订阅竞态） */
    get: () => Promise<IpcResult<TimerState>>;
    onState: (callback: (state: TimerState) => void) => Unsubscribe;
    onRemind: (callback: (event: RemindEvent) => void) => Unsubscribe;
  };
  settings: {
    get: () => Promise<IpcResult<Settings>>;
    update: (patch: Partial<Settings>) => Promise<IpcResult<Settings>>;
    onChanged: (callback: (settings: Settings) => void) => Unsubscribe;
  };
  stats: {
    get: () => Promise<IpcResult<DailyStats>>;
    /** 近 N 天历史（默认 7 天，含今天） */
    getHistory: (days?: number) => Promise<IpcResult<HistoryStats>>;
    onChanged: (callback: (stats: DailyStats) => void) => Unsubscribe;
  };
  window: {
    setMode: (mode: WindowMode) => Promise<IpcResult<WindowMode>>;
    onModeChanged: (callback: (mode: WindowMode) => void) => Unsubscribe;
    /** 收纳到最近屏幕侧边（仅 normal 模式按钮触发） */
    dock: () => Promise<IpcResult<DockState>>;
    /** 展开回收纳前的模式与位置 */
    undock: () => Promise<IpcResult<DockState>>;
    /** 收纳态变化推送（主进程为权威） */
    onDockedChanged: (callback: (state: DockState) => void) => Unsubscribe;
  };
  theme: {
    /** 主动拉取当前深浅色：本地 file:// 加载很快，推送可能早于订阅注册 */
    get: () => Promise<IpcResult<ThemeScheme>>;
    onSchemeChanged: (callback: (scheme: ThemeScheme) => void) => Unsubscribe;
  };
  /** 勿扰状态：手动开关 + 自动检测结果（主进程权威） */
  dnd: {
    get: () => Promise<IpcResult<DndState>>;
    onChanged: (callback: (state: DndState) => void) => Unsubscribe;
  };
  /** 自动更新：开发模式返回 idle，不发起网络请求 */
  update: {
    getStatus: () => Promise<IpcResult<UpdateStatus>>;
    check: () => Promise<IpcResult<UpdateStatus>>;
    download: () => Promise<IpcResult<UpdateStatus>>;
    install: () => Promise<IpcResult<null>>;
    onStatus: (callback: (status: UpdateStatus) => void) => Unsubscribe;
  };
  /** 数据备份：导出/导入完整 JSON（设置 + 历史统计） */
  data: {
    exportJson: () => Promise<IpcResult<DataBackupResult | null>>;
    importJson: () => Promise<IpcResult<DataRestoreResult | null>>;
  };
  app: {
    quit: () => Promise<IpcResult<null>>;
  };
}
