/**
 * 主进程入口：app 生命周期、组装各服务（Timer/Settings/Stats/Tray/Autostart/Health/Dnd）、
 * 注册 IPC、电源事件；关窗隐藏常驻，托盘「退出」真退出（决议 #4）。
 * P1：健康提醒与番茄到点提醒在合并窗口内只发一条（防双音轰炸）；主题深浅色随 nativeTheme 推送。
 */
import './bootstrap';
import { app, BrowserWindow, dialog, nativeTheme, powerMonitor } from 'electron';
import {
  APP_TITLE,
  IpcChannels,
  REMIND_MERGE_MS,
  UNRESPONSIVE_GRACE_MS as DEFAULT_UNRESPONSIVE_GRACE_MS,
} from '../shared/constants';
import {
  MAX_RENDERER_RECREATES_PER_MINUTE,
  decideCrashAction,
  recreateDelayMs,
} from '../shared/crashPolicy';
import { nextDndProbeDelayMs } from '../shared/dndPolicy';
import type { DockState, RemindEvent, RemindKind, ThemeScheme, WindowMode } from '../shared/types';
import { AutostartService } from './autostart';
import { DataTransferService } from './dataTransfer';
import { DndService } from './dnd';
import { HealthReminderService } from './health';
import { registerIpc } from './ipc';
import { logger } from './logger';
import { SettingsService } from './settings';
import { StatsService } from './stats';
import { TimerService } from './timer';
import { TrayService } from './tray';
import { UpdaterService } from './updater';
import {
  applyWindowMode,
  createMainWindow,
  dockToEdge,
  getDockState,
  isQuitting,
  markQuitting,
  persistWindowPos,
  resetDockRuntime,
  undockWindow,
} from './window';

/** E2E 测试模式：不写开机自启、不跑勿扰 PowerShell 探测，避免污染测试机 */
const E2E = process.env.POMODORO_E2E === '1';

/** unresponsive 宽限：生产 5s；E2E 可缩短到 1s，便于快速验证强制重建 */
const UNRESPONSIVE_GRACE_MS = E2E
  ? Math.max(500, Number(process.env.POMODORO_E2E_UNRESPONSIVE_GRACE_MS) || 1000)
  : DEFAULT_UNRESPONSIVE_GRACE_MS;

const settingsService = new SettingsService();
const statsService = new StatsService();
const autostartService = new AutostartService();

/**
 * 单实例锁（必须在 ready 前调用）：开机自启 + 手动双击可能同时拉起两个进程，
 * 两个实例各自持有计时器，并 read-modify-write 同一份 pomodoro-data.json，
 * 会导致统计/设置互相覆盖、托盘图标与提醒重复。拿不到锁的进程立即退出。
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

/** 第二次启动时只唤醒既有窗口（不新建、不重置计时） */
app.on('second-instance', () => {
  const win = mainWindow;
  if (win !== null && !win.isDestroyed()) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
    logger.info('second instance detected, existing window revealed');
  }
});

let mainWindow: BrowserWindow | null = null;
let timerService: TimerService | null = null;
let trayService: TrayService | null = null;
let healthService: HealthReminderService | null = null;
let dndService: DndService | null = null;
let updaterService: UpdaterService | null = null;
let currentMode: WindowMode = 'normal';

/** 勿扰探测的动态调度句柄（按 dndPolicy 降频，替代 DndService 内部常驻 interval） */
let dndProbeTimer: ReturnType<typeof setTimeout> | null = null;
/** 上一次计时状态：用于「开始计时」时立即刷新一次勿扰检测 */
let lastTimerStatus: 'idle' | 'running' | 'paused' = 'idle';
/** 渲染进程崩溃时间戳（60 秒滑动窗口，用于限流重建） */
let rendererCrashTimes: number[] = [];
/** 重建互斥：同一时刻只允许一个重建任务，防止重复 destroy 刚建好的窗口 */
let recreating = false;
let recreateTimer: ReturnType<typeof setTimeout> | null = null;
/** 60 秒窗口内按原因计数：launch-failed/integrity-failure 同原因只重试一次 */
let crashReasonCounts = new Map<string, number>();
/** 重建失败后的重试次数：0=首次，1=已重试一次 */
let recreateAttempt = 0;
/** E2E：下一次重建注入失败，验证重试与放弃路径 */
let e2eFailRecreate = E2E && process.env.POMODORO_E2E_FAIL_RECREATE === '1';

// ---------- 提醒合并（P1-1 防双音轰炸） ----------
const REMIND_PRIORITY: readonly RemindKind[] = ['focusEnd', 'breakEnd', 'sedentary', 'eyeCare'];
let pendingKinds: RemindKind[] = [];
let mergeTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueRemind(kind: RemindKind): void {
  pendingKinds.push(kind);
  if (mergeTimer !== null) {
    return;
  }
  mergeTimer = setTimeout(() => {
    mergeTimer = null;
    void flushReminds();
  }, REMIND_MERGE_MS);
}

/**
 * 合并窗口结束后发送提醒。发送前即时探测一次前台（最多等 600ms），
 * 避免缓存过期导致该静音时没静音；E2E 下跳过 PowerShell。
 */
async function flushReminds(): Promise<void> {
  const kinds = dedupe(pendingKinds);
  pendingKinds = [];
  const primary =
    REMIND_PRIORITY.find((candidate) => kinds.includes(candidate)) ?? kinds[0] ?? 'eyeCare';
  const service = dndService;
  if (service !== null && !E2E) {
    await Promise.race([
      service.detectNow(),
      new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ]);
  }
  const quiet = service?.isQuiet() ?? false;
  const event: RemindEvent = { kind: primary, kinds, quiet };
  sendToRenderer(IpcChannels.REMIND, event);
  logger.info(`remind sent kind=${primary} kinds=[${kinds.join(',')}] quiet=${quiet}`);
}

function dedupe(kinds: RemindKind[]): RemindKind[] {
  const seen = new Set<RemindKind>();
  const out: RemindKind[] = [];
  for (const kind of kinds) {
    if (!seen.has(kind)) {
      seen.add(kind);
      out.push(kind);
    }
  }
  return out;
}

// ---------- 主题深浅色（P1-3） ----------
function currentScheme(): ThemeScheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function broadcastScheme(): void {
  sendToRenderer(IpcChannels.THEME_SCHEME, currentScheme());
}

function sendToRenderer(channel: string, payload: unknown): void {
  const win = mainWindow;
  if (win !== null && !win.isDestroyed()) {
    const contents = win.webContents;
    // 崩溃后的 webContents 仍在窗口对象上，直接 send 会静默丢失甚至抛错
    if (contents.isDestroyed() || contents.isCrashed()) {
      return;
    }
    contents.send(channel, payload);
  }
}

/** 当前应采用的勿扰探测间隔（策略见 shared/dndPolicy，纯函数可单测） */
function currentDndProbeDelay(): number {
  const win = mainWindow;
  return nextDndProbeDelayMs({
    status: timerService?.getSnapshot().status ?? 'idle',
    windowVisible: win !== null && !win.isDestroyed() && win.isVisible(),
    minimized: win !== null && !win.isDestroyed() && win.isMinimized(),
    detectionAvailable: dndService?.isDetectionAvailable() ?? true,
  });
}

/**
 * 按策略安排下一次前台探测，探测完成后再计算间隔（自适应降频）。
 * 隐藏/最小化时由 bindWindow 直接 stopDndProbe()，不再后台轮询；
 * 提醒发送前另有 flushReminds() 即时探测兜底。
 */
function stopDndProbe(): void {
  if (dndProbeTimer !== null) {
    clearTimeout(dndProbeTimer);
    dndProbeTimer = null;
  }
}

function scheduleDndProbe(delayMs: number = currentDndProbeDelay()): void {
  if (E2E) {
    return;
  }
  stopDndProbe();
  dndProbeTimer = setTimeout(() => {
    dndProbeTimer = null;
    const service = dndService;
    if (service === null || isQuitting()) {
      return;
    }
    void service.detectNow().finally(() => {
      if (!isQuitting() && dndService !== null) {
        scheduleDndProbe(currentDndProbeDelay());
      }
    });
  }, Math.max(0, delayMs));
}

/** 窗口就绪回推与销毁清理（首次创建与崩溃重建共用，避免重复注册逻辑） */
function bindWindow(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    if (timerService !== null) {
      sendToRenderer(IpcChannels.TIMER_STATE, timerService.getSnapshot());
    }
    sendToRenderer(IpcChannels.SETTINGS_CHANGED, settingsService.get());
    sendToRenderer(IpcChannels.STATS_CHANGED, statsService.getToday());
    sendToRenderer(IpcChannels.WINDOW_MODE_CHANGED, currentMode);
    sendToRenderer(IpcChannels.WINDOW_DOCKED, getDockState());
    if (dndService !== null) {
      sendToRenderer(IpcChannels.DND_STATE, dndService.getState());
    }
    if (updaterService !== null) {
      sendToRenderer(IpcChannels.UPDATE_STATUS, updaterService.getStatus());
    }
    broadcastScheme();
  });
  win.on('show', () => scheduleDndProbe(0));
  win.on('restore', () => scheduleDndProbe(0));
  // 隐藏/最小化时完全暂停探测；提醒发送前会即时探测一次，显示后立即恢复
  win.on('hide', stopDndProbe);
  win.on('minimize', stopDndProbe);

  // 渲染进程卡死：先给宽限，仍无响应则强制崩溃，交给 render-process-gone 统一重建。
  // 只处理一次，避免同一窗口反复触发；responsive/closed 时清理定时器。
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  let unresponsiveHandled = false;
  const clearUnresponsiveTimer = (): void => {
    if (unresponsiveTimer !== null) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  };
  win.on('unresponsive', () => {
    if (unresponsiveHandled || isQuitting()) {
      return;
    }
    clearUnresponsiveTimer();
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (unresponsiveHandled || win.isDestroyed() || isQuitting()) {
        return;
      }
      unresponsiveHandled = true;
      logger.warn(
        `CRASH unresponsive window=${win.id} grace=${UNRESPONSIVE_GRACE_MS}ms, forcing crash`
      );
      try {
        win.webContents.forcefullyCrashRenderer();
      } catch (err) {
        logger.error('forcefullyCrashRenderer failed', err);
      }
    }, UNRESPONSIVE_GRACE_MS);
  });
  win.on('responsive', clearUnresponsiveTimer);

  win.on('closed', () => {
    clearUnresponsiveTimer();
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

/** 重建窗口的共用路径（崩溃自动重建 / 用户从托盘手动重启）；返回是否成功 */
function replaceRendererWindow(reason: string): boolean {
  // E2E 注入：验证「首次重建失败 → 800ms 重试 → 二次失败保留托盘入口」
  if (e2eFailRecreate) {
    e2eFailRecreate = false;
    logger.error(`CRASH recreate injected failure (${reason})`);
    return false;
  }
  const old = mainWindow;
  let win: BrowserWindow;
  try {
    win = createMainWindow();
  } catch (err) {
    logger.error('createMainWindow failed during recreate', err);
    return false;
  }
  // 收纳态是内存态且与窗口尺寸耦合：重建时复位，避免新窗口从把手尺寸/旧状态启动
  resetDockRuntime();
  currentMode = 'normal';
  mainWindow = win;
  bindWindow(win);
  if (old !== null && !old.isDestroyed()) {
    old.destroy();
  }
  // 新窗口已就绪，恢复托盘提示（崩溃放弃时曾改成引导文案）
  trayService?.setToolTip(APP_TITLE);
  logger.warn(`renderer window replaced (${reason})`);
  return true;
}

/** 渲染进程异常退出后重建窗口；失败时 800ms 重试一次，仍失败则保留托盘手动入口 */
function recreateRenderer(): void {
  recreating = false;
  if (isQuitting()) {
    return;
  }
  if (replaceRendererWindow('crash')) {
    recreateAttempt = 0;
    return;
  }
  if (recreateAttempt === 0) {
    recreateAttempt = 1;
    recreating = true;
    recreateTimer = setTimeout(() => {
      recreateTimer = null;
      recreateRenderer();
    }, 800);
    logger.warn('CRASH recreate retry scheduled in 800ms');
    return;
  }
  recreateAttempt = 0;
  trayService?.setToolTip('界面无法恢复，请退出后重新打开');
  logger.error('CRASH recreate failed after retry, waiting for manual restart');
}

/**
 * 用户主动重启界面：清空崩溃限流预算与待执行的重建任务，再走统一重建路径。
 * 典型场景是连续崩溃触发限流后，自动重建已放弃，用户从托盘恢复。
 */
function restartRenderer(): void {
  if (isQuitting()) {
    return;
  }
  if (recreateTimer !== null) {
    clearTimeout(recreateTimer);
    recreateTimer = null;
  }
  recreating = false;
  rendererCrashTimes = [];
  crashReasonCounts.clear();
  recreateAttempt = 0;
  e2eFailRecreate = false;
  try {
    replaceRendererWindow('user requested');
  } catch (err) {
    logger.error('restart renderer failed', err);
  }
}

/** 托盘「检查更新」：先把设置页显示出来，用户能看到检查/下载/安装状态 */
function checkForUpdatesFromTray(): void {
  mainWindow?.showInactive();
  if (mainWindow !== null && getDockState().docked) {
    undockWindow(mainWindow);
  }
  setWindowMode('settings');
  void updaterService?.check(true);
}

function setWindowMode(mode: WindowMode): void {
  const previousMode = currentMode;
  // 重复请求同一模式（双击最小化/还原）直接忽略，避免重启动画打断终帧。
  if (previousMode === mode) {
    return;
  }
  currentMode = mode;
  const win = mainWindow;
  if (win !== null && !win.isDestroyed()) {
    // 只有最小化/还原做 240↔160 补间；进入/退出设置页保持即时，避免输入框在动画中抢焦点。
    const animated = mode === 'compact' || (previousMode === 'compact' && mode === 'normal');
    applyWindowMode(win, mode, animated);
    sendToRenderer(IpcChannels.WINDOW_MODE_CHANGED, mode);
    // P1-7：收纳态下切模式会隐式展开，同步广播收纳态，避免渲染层仍渲染把手
    sendToRenderer(IpcChannels.WINDOW_DOCKED, getDockState());
  }
}

/** P1-7 收纳：主进程为权威状态，动画完成后由渲染层按推送只渲染把手 */
function handleDock(): DockState {
  const win = mainWindow;
  if (win === null || win.isDestroyed()) {
    return getDockState();
  }
  const state = dockToEdge(win);
  sendToRenderer(IpcChannels.WINDOW_DOCKED, state);
  return state;
}

/** P1-7 展开：恢复收纳前的模式与位置（不改变 currentMode） */
function handleUndock(): DockState {
  const win = mainWindow;
  if (win === null || win.isDestroyed()) {
    return getDockState();
  }
  const state = undockWindow(win);
  sendToRenderer(IpcChannels.WINDOW_DOCKED, state);
  return state;
}

function requestQuit(): void {
  markQuitting();
  stopDndProbe();
  if (recreateTimer !== null) {
    clearTimeout(recreateTimer);
    recreateTimer = null;
  }
  recreating = false;
  persistWindowPos(mainWindow);
  trayService?.dispose();
  timerService?.dispose();
  healthService?.dispose();
  dndService?.dispose();
  app.quit();
}

// 主进程未捕获异常：写日志并弹窗（ready 前 dialog 不可用，仅日志），然后退出，
// 避免进程留在后台但没有可用窗口。
process.on('uncaughtException', (err) => {
  logger.error('CRASH uncaughtException', err);
  try {
    dialog.showErrorBox(
      '番茄钟挂件出错',
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    );
  } catch {
    // ready 前 dialog 不可用，只依赖日志
  }
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('CRASH unhandledRejection', reason);
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) {
    return;
  }
  logger.startup(app.getVersion());
  settingsService.load();
  statsService.load();

  // 开机自启（决议 #4：默认开启）；E2E 不写注册表
  if (!E2E) {
    autostartService.apply(settingsService.get().autoStartAtLogin);
  }

  mainWindow = createMainWindow();

  timerService = new TimerService({
    getSettings: () => settingsService.get(),
    onState: (state) => {
      sendToRenderer(IpcChannels.TIMER_STATE, state);
      // 开始计时立即探测；暂停/结束按新状态重排，避免沿用运行态 10s 轮询
      if (state.status !== lastTimerStatus) {
        scheduleDndProbe(state.status === 'running' ? 0 : currentDndProbeDelay());
      }
      lastTimerStatus = state.status;
    },
    onRemind: (kind) => enqueueRemind(kind),
    onFocusCompleted: (focusDurationMs) => {
      statsService.addPomodoro();
      statsService.addFocusMs(focusDurationMs);
    },
  });

  // P1-1/P1-2 健康提醒（合并进同一 remind 通道）
  healthService = new HealthReminderService({
    getSettings: () => settingsService.get(),
    onRemind: (kind) => enqueueRemind(kind),
  });

  // P1-6 勿扰：剪辑软件前台自动降噪 + 手动开关
  dndService = new DndService({
    getSettings: () => settingsService.get(),
    onChange: (state) => sendToRenderer(IpcChannels.DND_STATE, state),
  });

  settingsService.onChange((settings) => {
    sendToRenderer(IpcChannels.SETTINGS_CHANGED, settings);
    // 时长变更：空闲/暂停态立即套用；running 不打断，下一阶段生效
    timerService?.applySettings();
    // 自启开关联动系统登录项（E2E 不碰注册表）
    if (!E2E) {
      autostartService.apply(settings.autoStartAtLogin);
    }
    // 手动勿扰开关变化 → 广播完整勿扰状态（自动检测部分由 DndService 推送）
    if (dndService !== null) {
      sendToRenderer(IpcChannels.DND_STATE, dndService.getState());
    }
  });

  statsService.onChange((stats) => {
    sendToRenderer(IpcChannels.STATS_CHANGED, stats);
  });

  const updater = new UpdaterService({
    onStatus: (status) => sendToRenderer(IpcChannels.UPDATE_STATUS, status),
  });
  updaterService = updater;
  updater.init();

  const dataTransfer = new DataTransferService({
    getWindow: () => mainWindow,
    settingsService,
    statsService,
  });

  registerIpc({
    timer: timerService,
    settingsService,
    statsService,
    dndService,
    updater,
    dataTransfer,
    setWindowMode,
    dock: handleDock,
    undock: handleUndock,
    requestQuit,
  });

  trayService = new TrayService({
    getWindow: () => mainWindow,
    showWindow: () => {
      mainWindow?.showInactive();
    },
    openSettings: () => {
      mainWindow?.showInactive();
      setWindowMode('settings');
    },
    requestQuit,
    checkForUpdates: checkForUpdatesFromTray,
    restartWindow: restartRenderer,
  });
  trayService.init();

  // 渲染层就绪/刷新后立即回推权威状态（T05 验收：刷新后以主进程为准恢复）
  bindWindow(mainWindow);
  // 首次勿扰探测立即执行，之后按 dndPolicy 自适应降频
  scheduleDndProbe(0);

  if (E2E) {
    // 暴露手动重启入口，供 e2e 在「重建失败/限流放弃」场景下验证恢复路径
    (globalThis as { __pomodoroRestartRenderer?: () => void }).__pomodoroRestartRenderer =
      restartRenderer;
  }

  // 渲染进程崩溃恢复：仅异常退出重建，60s 内最多 3 次，防止崩溃循环；
  // launch-failed/integrity-failure 同原因只重试一次，避免损坏包反复重建。
  app.on('render-process-gone', (_event, _contents, details) => {
    const now = Date.now();
    rendererCrashTimes = rendererCrashTimes.filter((t) => now - t < 60_000);
    const crashesBefore = rendererCrashTimes.length;
    const sameReason = crashReasonCounts.get(details.reason) ?? 0;
    const action = decideCrashAction(
      details.reason,
      crashesBefore,
      sameReason,
      MAX_RENDERER_RECREATES_PER_MINUTE
    );
    logger.error(
      `CRASH render-process-gone reason=${details.reason} exitCode=${details.exitCode} ` +
        `crashes=${crashesBefore} sameReason=${sameReason} action=${action}`
    );
    if (isQuitting() || action === 'ignore') {
      return;
    }
    if (recreating) {
      logger.warn('renderer crash while recreating, ignored');
      return;
    }
    if (action === 'give-up') {
      // 自动重建已放弃：托盘是用户唯一可见的恢复入口，给出明确提示
      trayService?.setToolTip('界面已停止，请右键托盘选择「重启界面」');
      logger.error('CRASH recreate budget exhausted, waiting for manual restart');
      return;
    }
    // 只有真正触发重建的崩溃才占用配额；killed/clean-exit 等不计入
    rendererCrashTimes.push(now);
    crashReasonCounts.set(details.reason, sameReason + 1);
    recreating = true;
    recreateAttempt = 0;
    const delay = recreateDelayMs(crashesBefore);
    logger.warn(`CRASH recreate scheduled in ${delay}ms`);
    // 让 Electron 完成崩溃清理后再建新窗口
    recreateTimer = setTimeout(() => {
      recreateTimer = null;
      recreateRenderer();
    }, delay);
  });

  // GPU/utility 等子进程异常只留痕，不打断计时
  app.on('child-process-gone', (_event, details) => {
    logger.warn(
      `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
    );
  });

  // P1-3 系统深浅色变化 → 推送渲染层
  nativeTheme.on('updated', () => {
    broadcastScheme();
    logger.info(`system scheme -> ${currentScheme()}`);
  });

  powerMonitor.on('resume', () => {
    timerService?.nudge();
    healthService?.nudge();
    logger.info('power resume, timer & health nudged');
  });
});

// 真退出前落标志（close 拦截据此放行）
app.on('before-quit', () => {
  markQuitting();
  persistWindowPos(mainWindow);
});

// 兜底：所有窗口销毁后退出（正常路径 close 被拦截为 hide，不会触发）
app.on('window-all-closed', () => {
  // 崩溃重建期间旧窗销毁会短暂触发该事件，交给 recreate 任务处理，避免误退出
  if (!isQuitting() && !recreating) {
    requestQuit();
  }
});
