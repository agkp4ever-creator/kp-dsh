/**
 * BrowserWindow 工厂：240×240 透明无边框置顶小窗（架构 §1.5 配置）。
 * skipTaskbar + focusable:false + alwaysOnTop('floating') + showInactive()，不做点击穿透。
 * close 拦截为 hide（常驻不退出，决议 #4）；窗口三模式尺寸切换见 applyWindowMode。
 * P1-5：位置记忆（PersistData.windowPos）+ 贴边吸附（边缘 12px 内）。
 * P1-7：手动收纳到屏幕侧边（方案 B，仅手动、无悬停自动展开）——窗口收缩为
 * 10×160 竖向把手贴边常驻，点击把手展开回收纳前的模式与位置。
 */
import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'path';
import {
  APP_TITLE,
  DEFAULT_EDGE_MARGIN,
  DOCK_ANIM_FRAME_MS,
  DOCK_ANIM_FRAMES,
  EDGE_SNAP_PX,
  WINDOW_COMPACT_OPACITY,
  WINDOW_SIZES,
} from '../shared/constants';
import {
  interpolateBounds,
  resolveDockBounds,
  resolveDockSide,
  resolveUndockBounds,
} from '../shared/dock';
import type { DockSide, DockState, WindowMode } from '../shared/types';
import { logger } from './logger';
import { readPersistData, writePersistData } from './store';

/** 退出中标志：true 时 close 不再拦截（托盘「退出」/ app:quit 置位） */
let quitting = false;

/**
 * 收纳运行态（P1-7 方案 B）：与 WindowMode 正交，只存在于内存，不落盘
 * （重启始终 normal 启动，不记忆收纳态）。
 */
interface DockRuntime {
  docked: boolean;
  side: DockSide;
  /** 收纳前窗口 bounds（含当时的模式尺寸），展开时原样恢复 */
  preDockBounds: Rectangle | null;
}

const dockRuntime: DockRuntime = { docked: false, side: 'right', preDockBounds: null };

/** 收纳/展开动画进行中：期间 moved 不吸附、不落盘 */
let dockAnimating = false;
/** moved 静默截止时间：动画期间排队的 moved 回调在结束后也要丢弃，防止覆盖 windowPos */
let moveMutedUntil = 0;
let dockTimer: ReturnType<typeof setInterval> | null = null;

/** 当前收纳态（主进程权威，供 IPC 返回与渲染层推送） */
export function getDockState(): DockState {
  return { docked: dockRuntime.docked, side: dockRuntime.side };
}

/** 标记真退出（之后 close 事件不再 hide） */
export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

export function createMainWindow(): BrowserWindow {
  const size = WINDOW_SIZES.normal;
  const initialPos = resolveInitialPosition(size.width, size.height);

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: initialPos.x,
    y: initialPos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: APP_TITLE,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.showInactive();
  win.setMenuBarVisibility(false);

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 常驻：关窗不退出，隐藏到托盘（决议 #4）
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      persistWindowPos(win);
      win.hide();
      logger.info('window hidden (resident mode)');
    }
  });

  // P1-5：拖动结束 → 贴边吸附 → 落盘
  // P1-7：收纳态 / 收纳动画期间一律跳过（把手不可拖拽，动画位移不算用户拖动）
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  win.on('moved', () => {
    if (isMoveSuppressed()) {
      return;
    }
    if (moveTimer !== null) {
      clearTimeout(moveTimer);
    }
    moveTimer = setTimeout(() => {
      moveTimer = null;
      if (win.isDestroyed() || isMoveSuppressed()) {
        return;
      }
      snapToEdges(win);
      persistWindowPos(win);
    }, 300);
  });

  win.on('closed', () => {
    logger.info('main window closed');
  });

  logger.info(`main window created 240x240 frameless topmost at ${initialPos.x},${initialPos.y}`);
  return win;
}

/**
 * 窗口模式切换（PRD §5.1）：
 * normal 240×240 / compact 160×160 / settings 320×420。
 * settings 模式临时 setFocusable(true) 以支持键盘微调（R2），收起还原。
 * 最小化（normal↔compact）可传 animate=true 做 160ms 尺寸+不透明度补间，
 * 收起后整窗压暗到 WINDOW_COMPACT_OPACITY；设置页始终即时切换。
 *
 * Windows 收缩 BugFix（设置页返回不恢复 240×240）：
 * resizable:false 的窗口在 Windows 上被 WM_GETMINMAXINFO 把当前尺寸当作
 * ptMinTrackSize（最小轨迹尺寸），裸 setSize 只能放大、收缩被系统静默忽略
 * （故 240→320×420 正常而 320×420→240 不生效，normal→compact 收缩同样受影响）。
 * 对策：resize 期间临时 setResizable(true) 放开钳制，setBounds 显式带当前位置
 * + 目标尺寸（避免位置漂移），用完立即还原 false（用户仍不可手动缩放）。
 * setFocusable 放在尺寸操作之前：WS_EX_NOACTIVATE 样式切换会触发
 * SetWindowPos(SWP_FRAMECHANGED)，置于 resize 之后可能把尺寸顶回旧值。
 */
export function setWindowClickThrough(win: BrowserWindow, enabled: boolean): void {
  if (win.isDestroyed()) {
    return;
  }
  // Windows 透明置顶窗默认仍会拦截鼠标；compact 态需整窗放行给下层剪辑软件。
  win.setIgnoreMouseEvents(enabled);
}

export function applyWindowMode(
  win: BrowserWindow,
  mode: WindowMode,
  animate = false,
  clickThrough = false
): void {
  // P1-7：收纳态下切模式（托盘「设置」等）先立即展开回收纳前 bounds，再走常规 resize，
  // 避免逐帧动画与 setBounds 抢写同一窗口位置。
  if (dockRuntime.docked) {
    undockWindow(win, true);
  }
  // 模式切换会改写目标尺寸：先停掉可能仍在跑的收纳/模式动画，避免它继续写旧目标。
  cancelDockAnimation();
  // 穿透必须在动画前生效：compact 收缩的 160ms 里也不能挡住剪辑软件点击。
  setWindowClickThrough(win, mode === 'compact' && clickThrough);

  const size = WINDOW_SIZES[mode];
  const targetOpacity = mode === 'compact' ? WINDOW_COMPACT_OPACITY : 1;

  // 最小化/还原：240↔160 尺寸和整体不透明度一起补间，窗口左上角保持不动。
  // settings 需要立即获得键盘焦点并撑开表单，保持即时切换、不参与动画。
  if (animate && mode !== 'settings') {
    const from = win.getBounds();
    const target = { x: from.x, y: from.y, width: size.width, height: size.height };
    animateWindowBounds(win, target, { from: win.getOpacity(), to: targetOpacity });
    logger.info(`window mode -> ${mode} (animated) ${size.width}x${size.height}`);
    return;
  }

  win.setFocusable(mode === 'settings');
  win.setResizable(true);
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: size.width, height: size.height });
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
  win.setOpacity(targetOpacity);
  logger.info(`window mode -> ${mode} ${size.width}x${size.height}`);
}

/**
 * 收纳到最近的屏幕侧边（P1-7 方案 B）：
 * 1. 以窗口所在显示器 workArea 判定左/右（窗口中心 vs 工作区中心）；
 * 2. 目标 10×160 贴边、垂直居中并钳回工作区；
 * 3. 记录收纳前 bounds → 逐帧收窄+移动（边收边移）→ 只留细把手。
 */
export function dockToEdge(win: BrowserWindow): DockState {
  // 动画期间再次触发（展开未结束就点收纳）会以中间帧当作 preDockBounds，直接忽略
  if (win.isDestroyed() || dockRuntime.docked || dockAnimating) {
    return getDockState();
  }
  const from = win.getBounds();
  const workArea = screen.getDisplayMatching(from).workArea;
  const side = resolveDockSide(from, workArea);
  const target = resolveDockBounds(from, workArea, side);

  dockRuntime.docked = true;
  dockRuntime.side = side;
  dockRuntime.preDockBounds = { ...from };

  animateWindowBounds(win, target);
  logger.info(
    `window dock -> ${side} ${target.width}x${target.height}@${target.x},${target.y} (pre ${from.x},${from.y} ${from.width}x${from.height})`
  );
  return getDockState();
}

/**
 * 展开：恢复收纳前的尺寸与位置（越界钳回工作区）。
 * immediate=true 时不做动画（供 applyWindowMode 内部复用，保证模式切换确定性）。
 */
export function undockWindow(win: BrowserWindow, immediate = false): DockState {
  if (!dockRuntime.docked) {
    return getDockState();
  }
  const preDock = dockRuntime.preDockBounds;
  const current = win.getBounds();
  const anchor: Rectangle =
    preDock !== null
      ? preDock
      : {
          x: current.x,
          y: current.y,
          width: WINDOW_SIZES.normal.width,
          height: WINDOW_SIZES.normal.height,
        };
  const workArea = screen.getDisplayMatching(anchor).workArea;
  const target = resolveUndockBounds(anchor, workArea);

  dockRuntime.docked = false;
  dockRuntime.preDockBounds = null;

  if (immediate) {
    cancelDockAnimation();
    applyDockBounds(win, target);
  } else {
    animateWindowBounds(win, target);
  }
  logger.info(`window undock -> ${target.x},${target.y} ${target.width}x${target.height}`);
  return getDockState();
}

/**
 * 重置收纳运行态（渲染进程崩溃重建时调用）：清动画、回到未收纳。
 * 收纳态与窗口尺寸耦合且只存在于内存，重建的新窗口必须以 normal 尺寸启动，
 * 否则 dockToEdge 会被残留的 docked=true 直接挡回，窗口永远卡在把手尺寸。
 */
export function resetDockRuntime(): void {
  cancelDockAnimation();
  dockRuntime.docked = false;
  dockRuntime.preDockBounds = null;
  moveMutedUntil = 0;
}

/** 动画期间/收纳态：moved 事件不参与吸附与落盘（位置持久化保护） */
function isMoveSuppressed(): boolean {
  return dockRuntime.docked || dockAnimating || Date.now() < moveMutedUntil;
}

/**
 * 逐帧 bounds 动画（收纳/展开对称，约 10 帧 × 16ms ≈ 160ms，ease-out）。
 * 沿用 applyWindowMode 的 Windows 收缩修复模式：
 * 非 resizable 窗口的当前尺寸会被 WM_GETMINMAXINFO 当作最小轨迹尺寸而拒绝缩小，
 * 故动画前 setResizable(true) 放开钳制、终帧落定后立即 setResizable(false)。
 * setFocusable 置于所有尺寸操作之前（避免 SWP_FRAMECHANGED 把尺寸顶回旧值）。
 */
/** 尺寸/位置补间的同时可选的整窗不透明度补间（用于最小化/还原） */
interface OpacityTween {
  from: number;
  to: number;
}

function animateWindowBounds(
  win: BrowserWindow,
  target: Rectangle,
  opacity?: OpacityTween
): void {
  cancelDockAnimation();
  const from = win.getBounds();
  const totalMs = DOCK_ANIM_FRAMES * DOCK_ANIM_FRAME_MS;
  dockAnimating = true;
  // 动画位移不算用户拖动：静默窗口覆盖动画时长 + moved 防抖余量
  moveMutedUntil = Date.now() + totalMs + 400;

  win.setFocusable(false);
  win.setResizable(true);

  let frame = 0;
  dockTimer = setInterval(() => {
    if (win.isDestroyed()) {
      cancelDockAnimation();
      return;
    }
    frame += 1;
    if (frame >= DOCK_ANIM_FRAMES) {
      // 终帧：精确落在目标 bounds（不依赖浮点插值），随后立即归还 resizable
      cancelDockAnimation();
      win.setBounds(target);
      if (opacity !== undefined) {
        win.setOpacity(opacity.to);
      }
      win.setResizable(false);
      win.setAlwaysOnTop(true, 'floating');
      return;
    }
    const progress = frame / DOCK_ANIM_FRAMES;
    win.setBounds(interpolateBounds(from, target, progress));
    if (opacity !== undefined) {
      win.setOpacity(opacity.from + (opacity.to - opacity.from) * progress);
    }
  }, DOCK_ANIM_FRAME_MS);
}

function cancelDockAnimation(): void {
  if (dockTimer !== null) {
    clearInterval(dockTimer);
    dockTimer = null;
  }
  dockAnimating = false;
}

/** 立即套用目标 bounds（无动画），调用序列与动画终帧一致 */
function applyDockBounds(win: BrowserWindow, target: Rectangle): void {
  win.setFocusable(false);
  win.setResizable(true);
  win.setBounds(target);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
}

/** 退出前显式落盘位置（由 requestQuit 调用） */
export function persistWindowPos(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) {
    return;
  }
  // P1-7：收纳态位置是把手位置，不能覆盖用户的正常位置记忆（重启始终 normal）
  if (isMoveSuppressed()) {
    return;
  }
  try {
    const [x, y] = win.getPosition();
    const data = readPersistData();
    data.windowPos = { x, y };
    writePersistData(data, { backup: false });
  } catch (err) {
    logger.error('persist window pos failed', err);
  }
}

/**
 * 启动位置：恢复上次位置（钳回**保存坐标所在显示器**的工作区），
 * 无记录则主屏右下角 24px（PRD §5.1）。
 * 旧实现固定用 getPrimaryDisplay()，副屏保存的坐标会被拽回主屏。
 */
function resolveInitialPosition(width: number, height: number): { x: number; y: number } {
  const saved = readPersistData().windowPos;
  const display =
    saved !== null
      ? screen.getDisplayNearestPoint({ x: Math.round(saved.x), y: Math.round(saved.y) })
      : screen.getPrimaryDisplay();
  const wa = display.workArea;
  if (saved !== null) {
    const x = clamp(saved.x, wa.x, wa.x + wa.width - width);
    const y = clamp(saved.y, wa.y, wa.y + wa.height - height);
    return { x, y };
  }
  return {
    x: wa.x + wa.width - width - DEFAULT_EDGE_MARGIN,
    y: wa.y + wa.height - height - DEFAULT_EDGE_MARGIN,
  };
}

/** 贴边吸附：距工作区边缘 ≤12px 时对齐到边缘（P1-5） */
function snapToEdges(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const wa = screen.getDisplayMatching(bounds).workArea;
  let { x, y } = bounds;

  if (Math.abs(x - wa.x) <= EDGE_SNAP_PX) {
    x = wa.x;
  } else if (Math.abs(x + bounds.width - (wa.x + wa.width)) <= EDGE_SNAP_PX) {
    x = wa.x + wa.width - bounds.width;
  }

  if (Math.abs(y - wa.y) <= EDGE_SNAP_PX) {
    y = wa.y;
  } else if (Math.abs(y + bounds.height - (wa.y + wa.height)) <= EDGE_SNAP_PX) {
    y = wa.y + wa.height - bounds.height;
  }

  x = clamp(x, wa.x, wa.x + wa.width - bounds.width);
  y = clamp(y, wa.y, wa.y + wa.height - bounds.height);

  if (x !== bounds.x || y !== bounds.y) {
    win.setPosition(x, y, false);
    logger.info(`window snapped to ${x},${y}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
