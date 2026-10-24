/**
 * TimerService：timestamp 驱动的番茄钟状态机（唯一权威）。
 *
 * 流转规则（架构 §7）：
 * - focus 完成 -> 自动进入休息（running）
 * - 休息完成 -> focus(idle)，等待用户轻启动（「开始下一个番茄」）
 * - skip 直接走 completePhase
 *
 * 测试钩子：POMODORO_FOCUS_MS / POMODORO_BREAK_MS 可覆盖阶段时长（毫秒）。
 */
import {
  createInitialTimerState,
  ENV_BREAK_MS,
  ENV_FOCUS_MS,
  MINUTE_MS,
  TICK_INTERVAL_MS,
} from '../shared/constants';
import type { Phase, RemindKind, Settings, TimerState } from '../shared/types';
import { elapsedMsOf, fixClockRollback, reconcilePhaseTime } from '../shared/timerMath';
import { logger } from './logger';

export interface TimerServiceDeps {
  getSettings: () => Settings;
  onState: (state: TimerState) => void;
  /** 到点提醒（组装层负责与健康提醒合并、防双音） */
  onRemind: (kind: RemindKind) => void;
  /** 专注阶段完成时结算统计（addPomodoro + addFocusMs），由组装层注入 StatsService */
  onFocusCompleted: (focusDurationMs: number) => void;
}

export class TimerService {
  private state: TimerState;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private readonly deps: TimerServiceDeps;
  /**
   * 上一 tick 的时钟快照：用于识别 Date.now() 回拨。
   * 只在 running 期间维护，pause/reset/到点后清空，避免把暂停期间的时间变化误判为回拨。
   */
  private lastTickNow: number | null = null;
  private lastTickRemainingMs: number | null = null;

  constructor(deps: TimerServiceDeps) {
    this.deps = deps;
    this.state = createInitialTimerState(this.durationOf('focus'));
    this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    logger.info('timer service started');
  }

  /** 开始 / 继续 */
  start(): void {
    if (this.state.status === 'running') {
      return;
    }
    const now = Date.now();
    this.state = { ...this.state, status: 'running', endsAt: now + this.state.remainingMs };
    // 记录启动快照：下一次 tick 据此判断期间是否发生时钟回拨
    this.lastTickNow = now;
    this.lastTickRemainingMs = this.state.remainingMs;
    this.emitState();
    logger.info('timer start');
  }

  /** 暂停：冻结剩余时间 */
  pause(): void {
    if (this.state.status !== 'running') {
      return;
    }
    const now = Date.now();
    const remainingMs = Math.max(0, (this.state.endsAt ?? now) - now);
    this.state = { ...this.state, status: 'paused', remainingMs, endsAt: null };
    // 暂停期间不维护时钟快照，恢复时重新取样
    this.lastTickNow = null;
    this.lastTickRemainingMs = null;
    this.emitState();
    logger.info('timer pause');
  }

  /** 重置：当前阶段回到满值、idle */
  reset(): void {
    const totalMs = this.durationOf(this.state.phase);
    this.state = {
      ...this.state,
      status: 'idle',
      remainingMs: totalMs,
      totalMs,
      endsAt: null,
    };
    this.lastTickNow = null;
    this.lastTickRemainingMs = null;
    this.emitState();
    logger.info('timer reset');
  }

  /** 跳过：直接走完当前阶段（统计按实际已专注时长结算，见 completePhase） */
  skip(): void {
    logger.info('timer skip');
    this.completePhase();
  }

  /**
   * 设置变更后同步当前阶段时长（修「空闲态改时长不生效」）：
   * - idle：立即套用新时长的满值
   * - paused：保留已走进度，按新总时长重算剩余
   * - running：不打断，下一阶段自然生效
   * 返回是否真的产生了状态变化（未变化时不重复推送）。
   */
  applySettings(): boolean {
    if (this.state.status === 'running') {
      return false;
    }
    const next = reconcilePhaseTime(
      this.state.status,
      this.state.totalMs,
      this.state.remainingMs,
      this.durationOf(this.state.phase)
    );
    if (next === null) {
      return false;
    }
    if (next.totalMs === this.state.totalMs && next.remainingMs === this.state.remainingMs) {
      return false;
    }
    this.state = { ...this.state, ...next };
    this.emitState();
    logger.info(
      `timer settings applied phase=${this.state.phase} total=${next.totalMs} remaining=${next.remainingMs}`
    );
    return true;
  }

  getSnapshot(): TimerState {
    return { ...this.state };
  }

  /** 系统睡眠唤醒后补算（powerMonitor resume） */
  nudge(): void {
    this.tick();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private tick(): void {
    if (this.state.status !== 'running' || this.state.endsAt === null) {
      return;
    }
    const now = Date.now();
    const endsAtBefore = this.state.endsAt;
    // 系统时钟被回拨时 endsAt - now 会变大，计时会变慢甚至“倒着走”；
    // 用上一 tick 快照重锚，保持剩余时长不因回拨而增加。
    const rollback = fixClockRollback(
      now,
      this.lastTickNow,
      this.lastTickRemainingMs,
      endsAtBefore
    );
    if (rollback !== null) {
      this.state = { ...this.state, endsAt: rollback.endsAt, remainingMs: rollback.remainingMs };
      logger.warn(`clock moved backwards ${rollback.rolledBackMs}ms, timer re-anchored`);
    }
    const endsAt = rollback?.endsAt ?? endsAtBefore;
    const remainingMs = Math.max(0, endsAt - now);
    if (remainingMs <= 0) {
      // 先归零再流转：completePhase 用 remainingMs 反推已专注时长，
      // 否则自然到点会按上一次 tick 的剩余值少算最后一小段。
      this.state = { ...this.state, remainingMs: 0, endsAt: null };
      this.lastTickNow = null;
      this.lastTickRemainingMs = null;
      this.completePhase();
      return;
    }
    this.state = { ...this.state, remainingMs };
    this.lastTickNow = now;
    this.lastTickRemainingMs = remainingMs;
    this.emitState();
  }

  /** 到点流转 + 提醒事件 */
  private completePhase(): void {
    const finished: Phase = this.state.phase;
    if (finished === 'focus') {
      // 实际已专注时长：自然到点为满额，中途 skip 只结算真实走过的部分
      const focusDurationMs = elapsedMsOf(this.state.totalMs, this.state.remainingMs);
      const cyclePomodoros = this.state.cyclePomodoros + 1;
      const nextPhase = this.nextBreakPhase(cyclePomodoros);
      const totalMs = this.durationOf(nextPhase);
      const now = Date.now();
      this.state = {
        phase: nextPhase,
        status: 'running',
        remainingMs: totalMs,
        totalMs,
        endsAt: now + totalMs,
        cyclePomodoros,
      };
      // 新阶段立刻开始，重置时钟快照（skip 进入时也走这里）
      this.lastTickNow = now;
      this.lastTickRemainingMs = totalMs;
      // 结算今日统计（架构 4.2：addPomodoro() + addFocusMs(focusDuration)）
      // 0 秒跳过（误触/脚本调用）不计番茄，避免统计虚高
      if (focusDurationMs > 0) {
        try {
          this.deps.onFocusCompleted(focusDurationMs);
        } catch (err) {
          logger.error('focus completion settle failed', err);
        }
      }
      this.emitState();
      this.deps.onRemind('focusEnd');
      logger.info(`phase focus -> ${nextPhase} (cycle=${cyclePomodoros})`);
      return;
    }
    const totalMs = this.durationOf('focus');
    this.state = {
      phase: 'focus',
      status: 'idle',
      remainingMs: totalMs,
      totalMs,
      endsAt: null,
      cyclePomodoros: this.state.cyclePomodoros,
    };
    // 休息结束回到 idle，停止时钟快照
    this.lastTickNow = null;
    this.lastTickRemainingMs = null;
    this.emitState();
    this.deps.onRemind('breakEnd');
    logger.info(`phase ${finished} -> focus (idle, awaiting next pomodoro)`);
  }

  /** 长休分档（tieredBreakEnabled 且整周期命中），否则短休 */
  private nextBreakPhase(cyclePomodoros: number): Phase {
    const settings = this.deps.getSettings();
    if (
      settings.tieredBreakEnabled &&
      settings.longBreakEvery > 0 &&
      cyclePomodoros % settings.longBreakEvery === 0
    ) {
      return 'longBreak';
    }
    return 'shortBreak';
  }

  /** 阶段时长（毫秒）：测试钩子环境变量优先于 settings */
  private durationOf(phase: Phase): number {
    return resolvePhaseDurationMs(phase, this.deps.getSettings());
  }

  private emitState(): void {
    this.deps.onState(this.getSnapshot());
  }
}

function envDurationMs(envKey: string): number | null {
  const raw = process.env[envKey];
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  logger.warn(`ignore invalid env duration ${envKey}=${raw}`);
  return null;
}

export function resolvePhaseDurationMs(phase: Phase, settings: Settings): number {
  const focusOverride = envDurationMs(ENV_FOCUS_MS);
  const breakOverride = envDurationMs(ENV_BREAK_MS);
  if (phase === 'focus') {
    return focusOverride ?? settings.focusMinutes * MINUTE_MS;
  }
  const minutes = phase === 'longBreak' ? settings.longBreakMinutes : settings.shortBreakMinutes;
  return breakOverride ?? minutes * MINUTE_MS;
}
