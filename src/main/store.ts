/**
 * JSON 文件持久化助手：userData/pomodoro-data.json，读容错、写原子（tmp + rename）。
 */
import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { THEME_NAMES } from '../shared/types';
import type { DailyStats, PersistData, Settings, ThemeName } from '../shared/types';

/** 持久化文件路径（userData/pomodoro-data.json） */
export function persistFilePath(): string {
  return join(app.getPath('userData'), 'pomodoro-data.json');
}

/** 自动备份路径：每次写入前保存上一版，主文件损坏时回退 */
export function backupFilePath(): string {
  return `${persistFilePath()}.bak`;
}

/** 解析并清洗任意 JSON 对象；非对象返回 null（导入时用于拒绝非法文件） */
export function parsePersistData(raw: unknown): PersistData | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return normalizePersistData(raw as Partial<PersistData>);
}

/** 读取持久化数据；主文件缺失/损坏时回退 .bak，仍失败则回退默认值，不抛出 */
export function readPersistData(): PersistData {
  for (const file of [persistFilePath(), backupFilePath()]) {
    try {
      if (!existsSync(file)) {
        continue;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
      const normalized = parsePersistData(parsed);
      if (normalized !== null) {
        return normalized;
      }
    } catch {
      // 主文件损坏时继续尝试 .bak
    }
  }
  return createDefaultPersistData();
}

/** 原子写入：先备份旧版（可按需关闭），再写 .tmp 并 rename 替换 */
export function writePersistData(
  data: PersistData,
  options: { backup?: boolean } = {}
): void {
  const file = persistFilePath();
  mkdirSync(dirname(file), { recursive: true });
  // 备份失败不阻塞主写入（例如首次保存、磁盘只读）；
  // 窗口位置等高频写入传 backup:false，避免把 .bak 刷成“最新版”
  try {
    if (options.backup !== false && existsSync(file)) {
      copyFileSync(file, backupFilePath());
    }
  } catch {
    // 忽略备份错误
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, file);
}

export function createDefaultPersistData(): PersistData {
  return {
    settings: { ...DEFAULT_SETTINGS },
    statsByDate: {},
    windowPos: null,
  };
}

/** 校验并清洗设置补丁：仅接受已知字段的合法值 */
export function sanitizeSettings(patch: Record<string, unknown>, base: Settings): Settings {
  const out: Settings = { ...base };

  const applyNumber = (key: keyof Settings, min: number, max: number): void => {
    const value = patch[key as string];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const clamped = Math.min(max, Math.max(min, Math.round(value)));
      if (key === 'focusMinutes') {
        out.focusMinutes = clamped;
      } else if (key === 'shortBreakMinutes') {
        out.shortBreakMinutes = clamped;
      } else if (key === 'longBreakMinutes') {
        out.longBreakMinutes = clamped;
      } else if (key === 'longBreakEvery') {
        out.longBreakEvery = clamped;
      } else if (key === 'volume') {
        out.volume = clamped;
      } else if (key === 'eyeCareIntervalMinutes') {
        out.eyeCareIntervalMinutes = clamped;
      } else if (key === 'sedentaryIntervalMinutes') {
        out.sedentaryIntervalMinutes = clamped;
      }
    }
  };

  const applyBoolean = (key: keyof Settings): void => {
    const value = patch[key as string];
    if (typeof value === 'boolean') {
      if (key === 'tieredBreakEnabled') {
        out.tieredBreakEnabled = value;
      } else if (key === 'muted') {
        out.muted = value;
      } else if (key === 'autoStartAtLogin') {
        out.autoStartAtLogin = value;
      } else if (key === 'showEyeCareTip') {
        out.showEyeCareTip = value;
      } else if (key === 'eyeCareEnabled') {
        out.eyeCareEnabled = value;
      } else if (key === 'sedentaryEnabled') {
        out.sedentaryEnabled = value;
      } else if (key === 'dndMode') {
        out.dndMode = value;
      } else if (key === 'compactClickThrough') {
        out.compactClickThrough = value;
      }
    }
  };

  applyNumber('focusMinutes', 1, 180);
  applyNumber('shortBreakMinutes', 1, 180);
  applyNumber('longBreakMinutes', 1, 180);
  applyNumber('longBreakEvery', 1, 12);
  applyNumber('volume', 0, 100);
  applyNumber('eyeCareIntervalMinutes', 5, 120);
  applyNumber('sedentaryIntervalMinutes', 10, 180);
  applyBoolean('tieredBreakEnabled');
  applyBoolean('muted');
  applyBoolean('autoStartAtLogin');
  applyBoolean('showEyeCareTip');
  applyBoolean('eyeCareEnabled');
  applyBoolean('sedentaryEnabled');
  applyBoolean('dndMode');
  applyBoolean('compactClickThrough');

  const theme = patch['theme'];
  if (typeof theme === 'string' && (THEME_NAMES as readonly string[]).includes(theme)) {
    out.theme = theme as ThemeName;
  }
  return out;
}

function normalizePersistData(raw: Partial<PersistData>): PersistData {
  const base = createDefaultPersistData();
  const settingsPatch =
    raw.settings !== null && typeof raw.settings === 'object'
      ? (raw.settings as unknown as Record<string, unknown>)
      : {};
  const settings = sanitizeSettings(settingsPatch, base.settings);

  const statsByDate: Record<string, DailyStats> = {};
  if (raw.statsByDate !== null && typeof raw.statsByDate === 'object') {
    for (const [key, value] of Object.entries(raw.statsByDate)) {
      if (value !== null && typeof value === 'object') {
        const v = value as Partial<DailyStats>;
        statsByDate[key] = {
          date: typeof v.date === 'string' ? v.date : key,
          completedPomodoros:
            typeof v.completedPomodoros === 'number' && Number.isFinite(v.completedPomodoros)
              ? Math.max(0, v.completedPomodoros)
              : 0,
          focusMs:
            typeof v.focusMs === 'number' && Number.isFinite(v.focusMs) ? Math.max(0, v.focusMs) : 0,
        };
      }
    }
  }

  let windowPos: PersistData['windowPos'] = null;
  if (raw.windowPos !== null && typeof raw.windowPos === 'object') {
    const p = raw.windowPos as { x?: unknown; y?: unknown };
    if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      windowPos = { x: p.x, y: p.y };
    }
  }

  return { settings, statsByDate, windowPos };
}
