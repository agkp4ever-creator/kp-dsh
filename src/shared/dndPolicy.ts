/**
 * 勿扰前台探测的调度策略（纯函数，无 Electron 依赖，供主进程与 node 断言共用）。
 *
 * 旧实现每 10 秒常驻 spawn 一次 PowerShell，空闲/隐藏时也在烧 CPU。
 * 新策略按「计时状态 + 窗口可见性 + 检测是否降级」动态降频：
 * - 计时运行中：30s（提醒触发前还会即时探测一次，保证静音判断准确）；
 * - 空闲/暂停但窗口可见：120s；
 * - 窗口隐藏/最小化：300s（组装层实际会暂停调度，显示时立即探测）；
 * - 连续探测失败已降级：600s（只做极低成本的恢复探测，不再频繁 spawn）。
 */
import type { TimerStatus } from './types';

export const DND_PROBE_RUNNING_MS = 30_000;
export const DND_PROBE_IDLE_MS = 120_000;
export const DND_PROBE_HIDDEN_MS = 300_000;
export const DND_PROBE_DEGRADED_MS = 600_000;

export interface DndProbeContext {
  status: TimerStatus;
  windowVisible: boolean;
  minimized: boolean;
  detectionAvailable: boolean;
}

/** 下一次前台探测的延迟（毫秒） */
export function nextDndProbeDelayMs(ctx: DndProbeContext): number {
  if (!ctx.detectionAvailable) {
    return DND_PROBE_DEGRADED_MS;
  }
  if (!ctx.windowVisible || ctx.minimized) {
    return DND_PROBE_HIDDEN_MS;
  }
  return ctx.status === 'running' ? DND_PROBE_RUNNING_MS : DND_PROBE_IDLE_MS;
}
