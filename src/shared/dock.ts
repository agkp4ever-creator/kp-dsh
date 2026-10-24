/**
 * 收纳态纯几何计算（P1-7 方案 B：手动收纳到屏幕侧边）。
 * 无 Electron / DOM 依赖，主进程与断言脚本（tests/dock-mode-assert.mjs）共用同一份实现，
 * 避免「测试复制一份算法」导致的假通过。
 */
import { DOCK_HANDLE_HEIGHT, DOCK_HANDLE_WIDTH } from './constants';
import type { DockSide } from './types';

/** 与 Electron Rectangle 结构一致（此处不引 Electron 类型，保持 shared 纯净） */
export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 收纳边判定：窗口中心在工作区中心左侧 → 左边缘，否则右边缘。
 * 多显示器场景传入窗口所在显示器的 workArea。
 */
export function resolveDockSide(bounds: DockRect, workArea: DockRect): DockSide {
  const windowCenterX = bounds.x + bounds.width / 2;
  const workAreaCenterX = workArea.x + workArea.width / 2;
  return windowCenterX < workAreaCenterX ? 'left' : 'right';
}

/**
 * 把手目标 bounds：10×160，贴住左/右工作区边缘；
 * 垂直方向以原窗口中心居中，超出工作区时钳回（不越出任务栏/屏幕）。
 */
export function resolveDockBounds(
  bounds: DockRect,
  workArea: DockRect,
  side: DockSide
): DockRect {
  const centeredY = Math.round(bounds.y + bounds.height / 2 - DOCK_HANDLE_HEIGHT / 2);
  const y = clamp(
    centeredY,
    workArea.y,
    workArea.y + workArea.height - DOCK_HANDLE_HEIGHT
  );
  const x =
    side === 'left' ? workArea.x : workArea.x + workArea.width - DOCK_HANDLE_WIDTH;
  return { x, y, width: DOCK_HANDLE_WIDTH, height: DOCK_HANDLE_HEIGHT };
}

/**
 * 展开目标 bounds：恢复收纳前的尺寸与位置；
 * 显示器拔插/分辨率变化导致越界时钳回工作区。
 */
export function resolveUndockBounds(preDock: DockRect, workArea: DockRect): DockRect {
  const x = clamp(preDock.x, workArea.x, workArea.x + workArea.width - preDock.width);
  const y = clamp(
    preDock.y,
    workArea.y,
    workArea.y + workArea.height - preDock.height
  );
  return { x, y, width: preDock.width, height: preDock.height };
}

/** ease-out cubic：起步快、收尾稳（与「克制」视觉基调一致） */
export function easeOutCubic(t: number): number {
  const p = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - p, 3);
}

/** 逐帧插值：t ∈ [0,1]；t=1 时严格等于目标 bounds（终帧校验用） */
export function interpolateBounds(from: DockRect, to: DockRect, t: number): DockRect {
  const e = easeOutCubic(t);
  return {
    x: Math.round(from.x + (to.x - from.x) * e),
    y: Math.round(from.y + (to.y - from.y) * e),
    width: Math.round(from.width + (to.width - from.width) * e),
    height: Math.round(from.height + (to.height - from.height) * e),
  };
}
