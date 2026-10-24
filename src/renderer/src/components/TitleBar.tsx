/**
 * TitleBar：状态点 + 标题 + 设置/紧凑/收纳按钮（PRD §5.2 顶栏），整条为拖动区。
 * 不提供窗口内退出口——退出走托盘右键（决议 #4 常驻不退出）。
 * P1-7：仅在 normal 模式显示「收纳」（settings/compact 不显示）。
 */
import type { Phase, TimerStatus, WindowMode } from '../../../shared/types';

export interface TitleBarProps {
  phase: Phase;
  status: TimerStatus;
  windowMode: WindowMode;
  /** 勿扰中（P1-6）：显示「勿扰」角标 */
  quiet: boolean;
  /** 勿扰来自自动检测（剪辑软件前台），用于区分角标提示文案 */
  quietAuto?: boolean;
  /** 设置模式下为「返回普通模式」，否则为「打开设置」 */
  onOpenSettings: () => void;
  /** 切换紧凑模式 */
  onToggleCompact: () => void;
  /** 收纳到屏幕侧边（仅 normal 模式提供） */
  onDock?: () => void;
}

function titleFor(phase: Phase, status: TimerStatus): string {
  if (phase === 'focus') {
    if (status === 'running') {
      return '专注中';
    }
    if (status === 'paused') {
      return '已暂停';
    }
    return '准备专注';
  }
  if (status === 'running') {
    return '休息一下';
  }
  if (status === 'paused') {
    return '休息暂停';
  }
  return '休息就绪';
}

export function TitleBar({
  phase,
  status,
  windowMode,
  quiet,
  quietAuto = false,
  onOpenSettings,
  onToggleCompact,
  onDock,
}: TitleBarProps): JSX.Element {
  const settingsOpen = windowMode === 'settings';
  const showDock = windowMode === 'normal' && onDock !== undefined;
  return (
    <header className="titlebar">
      <span
        className={`titlebar__dot titlebar__dot--${phase} titlebar__dot--${status}`}
        aria-hidden="true"
      />
      <span className="titlebar__title">{titleFor(phase, status)}</span>
      {quiet && (
        <span
          className="titlebar__dnd"
          title={
            quietAuto
              ? '自动勿扰：检测到剪辑软件前台，提醒仅视觉'
              : '勿扰中：提醒仅视觉'
          }
        >
          勿扰
        </span>
      )}
      <button
        type="button"
        className="titlebar__icon-btn"
        aria-label={settingsOpen ? '返回' : '设置'}
        title={settingsOpen ? '返回' : '设置'}
        onClick={onOpenSettings}
      >
        {settingsOpen ? '↩' : '⚙'}
      </button>
      {!settingsOpen && (
        <button
          type="button"
          className="titlebar__icon-btn"
          aria-label="紧凑模式"
          title="紧凑模式"
          onClick={onToggleCompact}
        >
          ➖
        </button>
      )}
      {showDock && (
        <button
          type="button"
          className="titlebar__icon-btn"
          aria-label="收纳到侧边"
          title="收纳到侧边"
          onClick={onDock}
        >
          ⇥
        </button>
      )}
    </header>
  );
}
