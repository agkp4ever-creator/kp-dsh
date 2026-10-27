/**
 * TitleBar：状态点 + 标题 + 设置/紧凑/收纳按钮（PRD §5.2 顶栏），整条为拖动区。
 * 不提供窗口内退出口——退出走托盘右键（决议 #4 常驻不退出）。
 * P1-7：仅在 normal 模式显示「收纳」（settings/compact 不显示）。
 */
import type { Phase, TimerStatus, WindowMode } from '../../../shared/types';
import { Icon } from './ui/Icon';

export interface TitleBarProps {
  phase: Phase;
  status: TimerStatus;
  windowMode: WindowMode;
  /** 勿扰中（P1-6）：显示「勿扰」角标 */
  quiet: boolean;
  /** 勿扰来自自动检测（剪辑软件前台），用于区分角标提示文案 */
  quietAuto?: boolean;
  /** 紧凑态是否开启鼠标穿透，用于按钮提示文案 */
  compactClickThrough?: boolean;
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
  compactClickThrough = true,
  onOpenSettings,
  onToggleCompact,
  onDock,
}: TitleBarProps): JSX.Element {
  const settingsOpen = windowMode === 'settings';
  const showDock = windowMode === 'normal' && onDock !== undefined;
  const title = settingsOpen ? '设置' : titleFor(phase, status);
  return (
    <header className="titlebar">
      {!settingsOpen && (
        <span
          className={`titlebar__dot titlebar__dot--${phase} titlebar__dot--${status}`}
          aria-hidden="true"
        />
      )}
      <span className="titlebar__title">{title}</span>
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
        {settingsOpen ? <Icon name="back" size={15} /> : <Icon name="settings" size={15} />}
      </button>
      {!settingsOpen && (
        <button
          type="button"
          className="titlebar__icon-btn"
          aria-label="紧凑模式"
          title={
            compactClickThrough
              ? '紧凑模式（穿透：双击托盘或 Ctrl+Alt+P 展开）'
              : '紧凑模式（点击恢复）'
          }
          onClick={onToggleCompact}
        >
          <Icon name="minimize" size={15} />
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
          <Icon name="dock" size={15} />
        </button>
      )}
    </header>
  );
}
