/**
 * 预加载：contextBridge 暴露白名单 API（window.pomodoro.*），通道字符串不出渲染层。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, TIMER_COMMANDS, WINDOW_MODES } from '../shared/constants';
import type {
  DailyStats,
  DataBackupResult,
  DataRestoreResult,
  DndState,
  DockState,
  HistoryStats,
  IpcResult,
  PomodoroApi,
  RemindEvent,
  Settings,
  ShortcutInfo,
  ThemeScheme,
  TimerCommand,
  TimerState,
  Unsubscribe,
  UpdateStatus,
  WindowMode,
} from '../shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

function assertCommand(command: TimerCommand): TimerCommand {
  if (!TIMER_COMMANDS.includes(command)) {
    throw new Error(`invalid timer command: ${String(command)}`);
  }
  return command;
}

function assertMode(mode: WindowMode): WindowMode {
  if (!WINDOW_MODES.includes(mode)) {
    throw new Error(`invalid window mode: ${String(mode)}`);
  }
  return mode;
}

const api: PomodoroApi = {
  timer: {
    command: (command: TimerCommand): Promise<IpcResult<TimerState>> => {
      return ipcRenderer.invoke(IpcChannels.TIMER_COMMAND, assertCommand(command));
    },
    get: (): Promise<IpcResult<TimerState>> => {
      return ipcRenderer.invoke(IpcChannels.TIMER_GET);
    },
    onState: (callback: (state: TimerState) => void): Unsubscribe => {
      return subscribe<TimerState>(IpcChannels.TIMER_STATE, callback);
    },
    onRemind: (callback: (event: RemindEvent) => void): Unsubscribe => {
      return subscribe<RemindEvent>(IpcChannels.REMIND, callback);
    },
  },
  settings: {
    get: (): Promise<IpcResult<Settings>> => {
      return ipcRenderer.invoke(IpcChannels.SETTINGS_GET);
    },
    update: (patch: Partial<Settings>): Promise<IpcResult<Settings>> => {
      return ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, patch);
    },
    onChanged: (callback: (settings: Settings) => void): Unsubscribe => {
      return subscribe<Settings>(IpcChannels.SETTINGS_CHANGED, callback);
    },
  },
  stats: {
    get: (): Promise<IpcResult<DailyStats>> => {
      return ipcRenderer.invoke(IpcChannels.STATS_GET);
    },
    getHistory: (days?: number): Promise<IpcResult<HistoryStats>> => {
      return ipcRenderer.invoke(IpcChannels.STATS_HISTORY, days);
    },
    onChanged: (callback: (stats: DailyStats) => void): Unsubscribe => {
      return subscribe<DailyStats>(IpcChannels.STATS_CHANGED, callback);
    },
  },
  window: {
    setMode: (mode: WindowMode): Promise<IpcResult<WindowMode>> => {
      return ipcRenderer.invoke(IpcChannels.WINDOW_SET_MODE, assertMode(mode));
    },
    onModeChanged: (callback: (mode: WindowMode) => void): Unsubscribe => {
      return subscribe<WindowMode>(IpcChannels.WINDOW_MODE_CHANGED, callback);
    },
    dock: (): Promise<IpcResult<DockState>> => {
      return ipcRenderer.invoke(IpcChannels.WINDOW_DOCK);
    },
    undock: (): Promise<IpcResult<DockState>> => {
      return ipcRenderer.invoke(IpcChannels.WINDOW_UNDOCK);
    },
    onDockedChanged: (callback: (state: DockState) => void): Unsubscribe => {
      return subscribe<DockState>(IpcChannels.WINDOW_DOCKED, callback);
    },
  },
  theme: {
    get: (): Promise<IpcResult<ThemeScheme>> => {
      return ipcRenderer.invoke(IpcChannels.THEME_GET);
    },
    onSchemeChanged: (callback: (scheme: ThemeScheme) => void): Unsubscribe => {
      return subscribe<ThemeScheme>(IpcChannels.THEME_SCHEME, callback);
    },
  },
  dnd: {
    get: (): Promise<IpcResult<DndState>> => {
      return ipcRenderer.invoke(IpcChannels.DND_GET);
    },
    onChanged: (callback: (state: DndState) => void): Unsubscribe => {
      return subscribe<DndState>(IpcChannels.DND_STATE, callback);
    },
  },
  update: {
    getStatus: (): Promise<IpcResult<UpdateStatus>> => {
      return ipcRenderer.invoke(IpcChannels.UPDATE_GET);
    },
    check: (): Promise<IpcResult<UpdateStatus>> => {
      return ipcRenderer.invoke(IpcChannels.UPDATE_CHECK);
    },
    download: (): Promise<IpcResult<UpdateStatus>> => {
      return ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD);
    },
    install: (): Promise<IpcResult<null>> => {
      return ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL);
    },
    onStatus: (callback: (status: UpdateStatus) => void): Unsubscribe => {
      return subscribe<UpdateStatus>(IpcChannels.UPDATE_STATUS, callback);
    },
  },
  data: {
    exportJson: (): Promise<IpcResult<DataBackupResult | null>> => {
      return ipcRenderer.invoke(IpcChannels.DATA_EXPORT);
    },
    importJson: (): Promise<IpcResult<DataRestoreResult | null>> => {
      return ipcRenderer.invoke(IpcChannels.DATA_IMPORT);
    },
  },
  app: {
    quit: (): Promise<IpcResult<null>> => {
      return ipcRenderer.invoke(IpcChannels.APP_QUIT);
    },
    getShortcut: (): Promise<IpcResult<ShortcutInfo>> => {
      return ipcRenderer.invoke(IpcChannels.SHORTCUT_GET);
    },
  },
};

contextBridge.exposeInMainWorld('pomodoro', api);
