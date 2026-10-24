/**
 * 渲染进程崩溃后的恢复策略（纯函数，供主进程与 node 断言共用）。
 *
 * 只对「异常退出」重建；用户主动结束（killed）、正常退出（clean-exit）不重建。
 * 60 秒窗口内连续崩溃达到上限后停止重建，避免崩溃循环把主进程拖死。
 * launch-failed / integrity-failure 只重试一次：二进制或 asar 损坏时反复重建没有意义。
 */
const RECREATABLE_REASONS = new Set([
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'abnormal-exit',
]);

/** 只允许重试一次的原因：再次失败就交给用户手动恢复 */
const RETRY_ONCE_REASONS = new Set(['launch-failed', 'integrity-failure']);

export type CrashAction = 'ignore' | 'recreate' | 'recreate-once' | 'give-up';

export const MAX_RENDERER_RECREATES_PER_MINUTE = 3;

/** 按窗口内第 N 次崩溃取退避：300ms → 800ms → 1500ms */
export const RECREATE_BACKOFF_MS = [300, 800, 1500] as const;

export function shouldRecreateRenderer(
  reason: string,
  crashesInWindow: number,
  maxCrashes: number = MAX_RENDERER_RECREATES_PER_MINUTE
): boolean {
  if (!RECREATABLE_REASONS.has(reason)) {
    return false;
  }
  if (!Number.isFinite(crashesInWindow) || crashesInWindow < 0) {
    return false;
  }
  return crashesInWindow < maxCrashes;
}

/**
 * 主进程使用的动作决策：
 * - ignore：killed/clean-exit/未知原因，不重建；
 * - recreate：常规崩溃，受 60s 窗口限流；
 * - recreate-once：launch-failed/integrity-failure 首次重建，再次同原因直接放弃；
 * - give-up：达到上限或同原因已重试过，保留托盘手动入口。
 */
export function decideCrashAction(
  reason: string,
  crashesInWindow: number,
  sameReasonCrashes = 0,
  maxCrashes: number = MAX_RENDERER_RECREATES_PER_MINUTE
): CrashAction {
  if (!RECREATABLE_REASONS.has(reason)) {
    return 'ignore';
  }
  if (!Number.isFinite(crashesInWindow) || crashesInWindow < 0) {
    return 'ignore';
  }
  if (!Number.isFinite(sameReasonCrashes) || sameReasonCrashes < 0) {
    return 'ignore';
  }
  if (crashesInWindow >= maxCrashes) {
    return 'give-up';
  }
  if (RETRY_ONCE_REASONS.has(reason)) {
    return sameReasonCrashes >= 1 ? 'give-up' : 'recreate-once';
  }
  return 'recreate';
}

/** 崩溃前已发生次数 → 本次重建延迟（毫秒） */
export function recreateDelayMs(crashesInWindow: number): number {
  const index = Number.isFinite(crashesInWindow)
    ? Math.max(0, Math.floor(crashesInWindow))
    : 0;
  return RECREATE_BACKOFF_MS[Math.min(index, RECREATE_BACKOFF_MS.length - 1)];
}
