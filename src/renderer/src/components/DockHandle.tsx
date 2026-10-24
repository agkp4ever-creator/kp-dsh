/**
 * DockHandle：收纳态唯一的界面（P1-7 方案 B）。
 * 窗口此时仅 10×160，贴屏幕左/右边缘——半透明暗色毛玻璃竖条 +
 * 一条按 remainingMs/totalMs 比例的剩余时间进度线（圆角）。
 * 整条只响应点击展开，不提供拖动区（收纳时禁止拖拽/双击）。
 */
import type { DockSide, Phase } from '../../../shared/types';

export interface DockHandleProps {
  side: DockSide;
  phase: Phase;
  remainingMs: number;
  totalMs: number;
  onExpand: () => void;
}

export function DockHandle({
  side,
  phase,
  remainingMs,
  totalMs,
  onExpand,
}: DockHandleProps): JSX.Element {
  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const isBreak = phase !== 'focus';

  return (
    <div
      className={`dock-handle dock-handle--${side}${isBreak ? ' dock-handle--break' : ''}`}
      title="点击展开挂件"
      role="button"
      tabIndex={-1}
      onClick={onExpand}
    >
      <div className="dock-handle__track" aria-hidden="true">
        <div className="dock-handle__progress" style={{ height: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
