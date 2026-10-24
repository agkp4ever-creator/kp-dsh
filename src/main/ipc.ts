/**
 * 全部 ipcMain handler 注册与参数校验；返回统一 { ok, data?, error? } 信封（架构 §7）。
 */
import { ipcMain, nativeTheme } from 'electron';
import { IpcChannels, TIMER_COMMANDS, WINDOW_MODES } from '../shared/constants';
import type {
  DailyStats,
  DndState,
  DockState,
  IpcResult,
  Settings,
  TimerCommand,
  TimerState,
  UpdateStatus,
  WindowMode,
} from '../shared/types';
import { logger } from './logger';
import type { DndService } from './dnd';
import type { SettingsService } from './settings';
import type { StatsService } from './stats';
import type { TimerService } from './timer';
import type { UpdaterService } from './updater';

export interface IpcDeps {
  timer: TimerService;
  settingsService: SettingsService;
  statsService: StatsService;
  /** 勿扰状态（手动开关 + 自动检测） */
  dndService: DndService;
  setWindowMode: (mode: WindowMode) => void;
  /** P1-7 收纳到最近屏幕侧边，返回收纳态 */
  dock: () => DockState;
  /** P1-7 展开回收纳前的模式与位置 */
  undock: () => DockState;
  /** 自动更新（安装版；开发模式为 no-op） */
  updater: UpdaterService;
  requestQuit: () => void;
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function fail(error: string): IpcResult<never> {
  return { ok: false, error };
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(
    IpcChannels.TIMER_COMMAND,
    (_event, raw: unknown): IpcResult<TimerState> => {
      if (typeof raw !== 'string' || !(TIMER_COMMANDS as readonly string[]).includes(raw)) {
        logger.warn(`invalid timer command: ${String(raw)}`);
        return fail('invalid timer command');
      }
      const command = raw as TimerCommand;
      switch (command) {
        case 'start':
          deps.timer.start();
          break;
        case 'pause':
          deps.timer.pause();
          break;
        case 'reset':
          deps.timer.reset();
          break;
        case 'skip':
          deps.timer.skip();
          break;
      }
      return ok(deps.timer.getSnapshot());
    }
  );

  ipcMain.handle(IpcChannels.TIMER_GET, (): IpcResult<TimerState> => ok(deps.timer.getSnapshot()));

  ipcMain.handle(IpcChannels.SETTINGS_GET, (): IpcResult<Settings> => ok(deps.settingsService.get()));

  ipcMain.handle(
    IpcChannels.SETTINGS_UPDATE,
    (_event, raw: unknown): IpcResult<Settings> => {
      if (raw === null || typeof raw !== 'object') {
        logger.warn('invalid settings patch');
        return fail('invalid settings patch');
      }
      return ok(deps.settingsService.update(raw as Partial<Settings>));
    }
  );

  ipcMain.handle(IpcChannels.STATS_GET, (): IpcResult<DailyStats> => ok(deps.statsService.getToday()));

  ipcMain.handle(
    IpcChannels.WINDOW_SET_MODE,
    (_event, raw: unknown): IpcResult<WindowMode> => {
      if (typeof raw !== 'string' || !(WINDOW_MODES as readonly string[]).includes(raw)) {
        logger.warn(`invalid window mode: ${String(raw)}`);
        return fail('invalid window mode');
      }
      const mode = raw as WindowMode;
      deps.setWindowMode(mode);
      return ok(mode);
    }
  );

  ipcMain.handle(IpcChannels.WINDOW_DOCK, (): IpcResult<DockState> => ok(deps.dock()));

  ipcMain.handle(IpcChannels.WINDOW_UNDOCK, (): IpcResult<DockState> => ok(deps.undock()));

  ipcMain.handle(IpcChannels.DND_GET, (): IpcResult<DndState> => ok(deps.dndService.getState()));

  ipcMain.handle(
    IpcChannels.THEME_GET,
    (): IpcResult<'dark' | 'light'> => ok(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  );

  ipcMain.handle(IpcChannels.UPDATE_GET, (): IpcResult<UpdateStatus> => ok(deps.updater.getStatus()));

  ipcMain.handle(
    IpcChannels.UPDATE_CHECK,
    async (): Promise<IpcResult<UpdateStatus>> => ok(await deps.updater.check(true))
  );

  ipcMain.handle(
    IpcChannels.UPDATE_DOWNLOAD,
    async (): Promise<IpcResult<UpdateStatus>> => ok(await deps.updater.download())
  );

  ipcMain.handle(IpcChannels.UPDATE_INSTALL, (): IpcResult<null> => {
    deps.updater.install();
    return ok(null);
  });

  ipcMain.handle(IpcChannels.APP_QUIT, (): IpcResult<null> => {
    logger.info('app quit requested');
    deps.requestQuit();
    return ok(null);
  });

  logger.info('ipc handlers registered');
}
