/**
 * App 根组件：订阅计时/设置/统计状态，播放到点提醒音（勿扰时仅视觉），切换专注/休息视觉，
 * 按窗口模式（normal/compact/settings）切换布局，注入主题变量（P1-3 深浅色），
 * 健康提醒横幅（P1-1 护眼 / P1-2 久坐）；
 * P1-7 收纳态（正交状态）优先于模式渲染——只渲染贴边把手。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DockState,
  RemindEvent,
  RemindKind,
  ThemeScheme,
  TimerCommand,
  UpdateStatus,
  WindowMode,
} from '../../shared/types';
import { playRemind, resumeAudio } from './audio';
import { ControlBar } from './components/ControlBar';
import { DockHandle } from './components/DockHandle';
import { SettingsPanel } from './components/SettingsPanel';
import { StatsBar } from './components/StatsBar';
import { TimerRing } from './components/TimerRing';
import { TipLine } from './components/TipLine';
import { TitleBar } from './components/TitleBar';
import { useDnd } from './hooks/useDnd';
import { useSettings } from './hooks/useSettings';
import { useStats } from './hooks/useStats';
import { useTimer } from './hooks/useTimer';
import { applyTheme } from './theme';

const REMIND_FLASH_MS = 600;

/** 健康提醒横幅文案与展示时长 */
const HEALTH_BANNER: Record<RemindKind, { text: string; durationMs: number } | null> = {
  focusEnd: null,
  breakEnd: null,
  eyeCare: { text: '护眼 20-20-20 · 看看 6 米外 20 秒', durationMs: 20_000 },
  sedentary: { text: '久坐提醒 · 起身活动一下', durationMs: 15_000 },
};

export default function App(): JSX.Element {
  const { state, send } = useTimer();
  const { settings, update } = useSettings();
  const { stats } = useStats();
  const dnd = useDnd();
  const [remindKind, setRemindKind] = useState<RemindEvent['kind'] | null>(null);
  const [healthText, setHealthText] = useState<string | null>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>('normal');
  const [dockState, setDockState] = useState<DockState>({ docked: false, side: 'right' });
  const [scheme, setScheme] = useState<ThemeScheme>('dark');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 窗口模式以主进程推送为准（T05：刷新后恢复）
  useEffect(() => {
    return window.pomodoro.window.onModeChanged((mode) => {
      setWindowMode(mode);
    });
  }, []);

  // 收纳态以主进程推送为准（P1-7：与 WindowMode 正交，重启不记忆）
  useEffect(() => {
    return window.pomodoro.window.onDockedChanged((next) => {
      setDockState(next);
    });
  }, []);

  // 主题深浅色以主进程 nativeTheme 推送为准（P1-3）；
  // 本地 file:// 加载很快，did-finish-load 推送可能早于订阅，订阅后主动拉一次兜底
  useEffect(() => {
    let pushed = false;
    const unsubscribe = window.pomodoro.theme.onSchemeChanged((next) => {
      pushed = true;
      setScheme(next);
    });
    void window.pomodoro.theme.get().then((result) => {
      if (!pushed && result.ok && result.data !== undefined) {
        setScheme(result.data);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    applyTheme(settings.theme, scheme);
  }, [settings.theme, scheme]);

  // 自动更新状态：订阅推送 + 主动拉取兜底（file:// 首帧可能早于订阅）
  useEffect(() => {
    let pushed = false;
    const unsubscribe = window.pomodoro.update.onStatus((next) => {
      pushed = true;
      setUpdateStatus(next);
    });
    void window.pomodoro.update.getStatus().then((result) => {
      if (!pushed && result.ok && result.data !== undefined) {
        setUpdateStatus(result.data);
      }
    });
    return unsubscribe;
  }, []);

  // 到点提醒：轻提示音 + 视觉闪动（勿扰中仅视觉；禁止系统通知/语音）
  useEffect(() => {
    return window.pomodoro.timer.onRemind((event) => {
      playRemind(event.kind, settingsRef.current, event.quiet);
      setRemindKind(event.kind);
      // 合并批次内的健康提醒都展示横幅（取第一个命中的）
      for (const kind of event.kinds) {
        const banner = HEALTH_BANNER[kind];
        if (banner !== null) {
          setHealthText(banner.text);
          window.setTimeout(() => {
            setHealthText((current) => (current === banner.text ? null : current));
          }, banner.durationMs);
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    if (remindKind === null) {
      return undefined;
    }
    const handle = setTimeout(() => setRemindKind(null), REMIND_FLASH_MS);
    return () => clearTimeout(handle);
  }, [remindKind]);

  // 首次用户手势时解锁 AudioContext
  useEffect(() => {
    const onPointerDown = (): void => {
      resumeAudio();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const handleCommand = useCallback(
    (command: TimerCommand) => {
      send(command);
    },
    [send]
  );

  const requestMode = useCallback((mode: WindowMode) => {
    void window.pomodoro.window.setMode(mode);
  }, []);

  const requestDock = useCallback(() => {
    void window.pomodoro.window.dock();
  }, []);

  const requestUndock = useCallback(() => {
    void window.pomodoro.window.undock();
  }, []);

  const handleCheckUpdate = useCallback(() => {
    void window.pomodoro.update.check();
  }, []);

  const handleDownloadUpdate = useCallback(() => {
    void window.pomodoro.update.download();
  }, []);

  const handleInstallUpdate = useCallback(() => {
    void window.pomodoro.update.install();
  }, []);

  const isBreak = state.phase !== 'focus';
  // 勿扰以主进程为准：手动开关 或 自动命中剪辑软件前台
  const quiet = dnd.quiet;

  // 收纳态（P1-7）：优先于模式——窗口只剩 10×160 把手，不渲染挂件本体
  if (dockState.docked) {
    return (
      <DockHandle
        side={dockState.side}
        phase={state.phase}
        remainingMs={state.remainingMs}
        totalMs={state.totalMs}
        onExpand={requestUndock}
      />
    );
  }

  // 设置模式：320×420，仅顶栏 + 设置面板
  if (windowMode === 'settings') {
    return (
      <div className="app-shell app-shell--settings">
        <TitleBar
          phase={state.phase}
          status={state.status}
          windowMode={windowMode}
          quiet={quiet}
          quietAuto={dnd.auto}
          onOpenSettings={() => requestMode('normal')}
          onToggleCompact={() => requestMode('normal')}
        />
        <SettingsPanel
          settings={settings}
          onUpdate={update}
          onClose={() => requestMode('normal')}
          updateStatus={updateStatus}
          onCheckUpdate={handleCheckUpdate}
          onDownloadUpdate={handleDownloadUpdate}
          onInstallUpdate={handleInstallUpdate}
        />
      </div>
    );
  }

  // 紧凑模式：160×160 只显示圆环（点击恢复普通模式）
  if (windowMode === 'compact') {
    return (
      <div
        className="app-shell app-shell--compact"
        title="点击恢复普通模式"
        onClick={() => requestMode('normal')}
      >
        <main className="app-body app-body--compact">
          <TimerRing
            remainingMs={state.remainingMs}
            totalMs={state.totalMs}
            endsAt={state.endsAt}
            phase={state.phase}
            status={state.status}
            remindKind={remindKind}
          />
        </main>
      </div>
    );
  }

  // 普通模式：240×240 主界面
  return (
    <div className="app-shell">
      <TitleBar
        phase={state.phase}
        status={state.status}
        windowMode={windowMode}
        quiet={quiet}
        quietAuto={dnd.auto}
        onOpenSettings={() => requestMode('settings')}
        onToggleCompact={() => requestMode('compact')}
        onDock={requestDock}
      />
      <main className="app-body">
        <TimerRing
          remainingMs={state.remainingMs}
          totalMs={state.totalMs}
          endsAt={state.endsAt}
          phase={state.phase}
          status={state.status}
          remindKind={remindKind}
        />
        {healthText !== null ? (
          <div className="health-banner">{healthText}</div>
        ) : (
          <TipLine visible={isBreak && settings.showEyeCareTip} />
        )}
        <ControlBar state={state} onCommand={handleCommand} />
        <StatsBar
          stats={stats}
          cyclePomodoros={state.cyclePomodoros}
          tieredBreakEnabled={settings.tieredBreakEnabled}
          longBreakEvery={settings.longBreakEvery}
        />
      </main>
    </div>
  );
}
