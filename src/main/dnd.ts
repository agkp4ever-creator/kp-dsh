/**
 * DndService：P1-6 勿扰模式。
 * 实现层级（README 如实标注）：
 *   a) 自动检测：轮询前台进程名（PowerShell GetForegroundWindow，尽力而为），
 *      命中剪辑软件（Adobe Premiere / 剪映 / DaVinci Resolve）→ 自动降噪；
 *   b) 降级：前台检测在受限环境不可用时自动停用，仅保留手动勿扰开关（settings.dndMode）。
 * 降噪语义 = 提醒仅视觉（不发声），由 RemindEvent.quiet 传给渲染层。
 */
import { execFile } from 'child_process';
import type { DndState, Settings } from '../shared/types';
import { logger } from './logger';

/** 剪辑软件进程名匹配（大小写不敏感，含常见别名） */
const EDITING_PROCESS_PATTERNS: readonly RegExp[] = [
  /premiere/i,
  /after\s?effects/i,
  /davinci\s?resolve/i,
  /jianying/i,
  /capcut/i,
];

/** 连续失败多少次后放弃自动检测（降级为仅手动勿扰） */
const MAX_DETECT_FAILURES = 3;

/** PowerShell 查询前台窗口进程名（Windows-only，失败静默降级） */
const PS_FOREGROUND =
  'Add-Type @\'\nusing System;\nusing System.Runtime.InteropServices;\npublic class F {\n  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\n}\n\'@; $h=[F]::GetForegroundWindow(); $p=0; [F]::GetWindowThreadProcessId($h,[ref]$p) | Out-Null; (Get-Process -Id $p).ProcessName';

export interface DndServiceDeps {
  getSettings: () => Settings;
  /** 自动检测结果变化时上报（手动 dndMode 变化由 settings 变更侧广播） */
  onChange?: (state: DndState) => void;
}

export class DndService {
  private editingForeground = false;
  private detectFailures = 0;
  private detectionAvailable = true;
  private detecting = false;
  private readonly deps: DndServiceDeps;

  constructor(deps: DndServiceDeps) {
    this.deps = deps;
    // 不再在服务内部常驻 setInterval：由组装层按 dndPolicy 动态调度 detectNow()，
    // 空闲/隐藏/降级时自动降频，避免每 10 秒 spawn 一次 PowerShell。
    logger.info('dnd service started (auto-detect best-effort, scheduled)');
  }

  /** 当前是否勿扰（手动开关 或 检测到剪辑软件前台） */
  isQuiet(): boolean {
    return this.deps.getSettings().dndMode || this.editingForeground;
  }

  /** 勿扰完整状态（供渲染层区分手动/自动，并展示降级提示） */
  getState(): DndState {
    return {
      quiet: this.isQuiet(),
      auto: this.editingForeground,
      detectionAvailable: this.detectionAvailable,
    };
  }

  /** 自动检测是否可用（false = 已降级为仅手动开关，供 UI/README 展示） */
  isDetectionAvailable(): boolean {
    return this.detectionAvailable;
  }

  dispose(): void {
    // 调度句柄由组装层持有（index.ts 的 dndProbeTimer），此处无内部定时器可清
  }

  /** 立即探测一次前台进程（由组装层按 dndPolicy 调度） */
  async detectNow(): Promise<void> {
    // 降级（detectionAvailable=false）后仍允许探测：调度降为 300s 一次，
    // 一旦 PowerShell 恢复可用就自动升回自动检测，而不是永久锁死在手动模式。
    if (this.detecting) {
      return;
    }
    this.detecting = true;
    const before = this.getState();
    try {
      const name = await this.foregroundProcessName();
      if (name === null) {
        this.detectFailures += 1;
        if (this.detectFailures >= MAX_DETECT_FAILURES && this.detectionAvailable) {
          this.detectionAvailable = false;
          // 检测不可用时无法确认前台，清空自动勿扰，避免停留在「永久勿扰」；
          // 手动 dndMode 仍由设置控制，不受影响。
          this.editingForeground = false;
          logger.warn('foreground detection unavailable, degrade to manual dnd only');
        }
        return;
      }
      this.detectFailures = 0;
      this.detectionAvailable = true;
      const matched = EDITING_PROCESS_PATTERNS.some((pattern) => pattern.test(name));
      if (matched !== this.editingForeground) {
        this.editingForeground = matched;
        logger.info(`editing foreground -> ${matched} (process=${name})`);
      }
    } finally {
      this.detecting = false;
      this.emitChangeIfNeeded(before);
    }
  }

  /** 自动检测状态有变化才推送，避免每 10 秒刷一次 IPC */
  private emitChangeIfNeeded(before: DndState): void {
    const after = this.getState();
    if (
      after.quiet !== before.quiet ||
      after.auto !== before.auto ||
      after.detectionAvailable !== before.detectionAvailable
    ) {
      this.deps.onChange?.(after);
    }
  }

  /** 探测前台进程名；失败返回 null（不抛出） */
  private foregroundProcessName(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', PS_FOREGROUND],
          { timeout: 4000, windowsHide: true },
          (error, stdout) => {
            if (error) {
              resolve(null);
              return;
            }
            resolve(String(stdout).trim() || null);
          }
        );
      } catch {
        resolve(null);
      }
    });
  }
}
