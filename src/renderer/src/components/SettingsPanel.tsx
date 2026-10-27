/**
 * SettingsPanel：设置面板（UI 统一层）。
 * 固定底栏 + 独立滚动区；分组卡片、色卡主题、长按 Stepper、整行 Toggle。
 * 业务字段与 aria-label 保持原样，避免 e2e 回归。
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { HistoryStats, Settings, ThemeName, UpdateStatus } from '../../../shared/types';
import { formatDurationMs } from '../../../shared/format';
import { HistoryChart } from './HistoryChart';
import { Icon } from './ui/Icon';

export interface SettingsPanelProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  updateStatus: UpdateStatus | null;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  /** 近 7 天历史（null = 尚未加载） */
  history: HistoryStats | null;
  dataMessage: string | null;
  onExportData: () => void;
  onImportData: () => void;
}

const FOCUS_MIN = 1;
const FOCUS_MAX = 180;
const BREAK_MIN = 1;
const BREAK_MAX = 180;
const EVERY_MIN = 2;
const EVERY_MAX = 12;
const EYE_MIN = 5;
const EYE_MAX = 120;
const SED_MIN = 10;
const SED_MAX = 180;

/** 视觉主题选项：与 shared/types.ts 的 THEME_NAMES 保持一致 */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeName; label: string; swatch: string }> = [
  { value: 'minimal', label: '极简黑白', swatch: 'linear-gradient(90deg, #f5f5f5, #2b2b2b)' },
  { value: 'tomato', label: '番茄红', swatch: 'linear-gradient(90deg, #e8503a, #f2efea)' },
  { value: 'forest', label: '森林绿', swatch: 'linear-gradient(90deg, #6cc79a, #d9a441)' },
  { value: 'ocean', label: '深海蓝', swatch: 'linear-gradient(90deg, #57a9dd, #5fbf8c)' },
  { value: 'lavender', label: '薰衣草', swatch: 'linear-gradient(90deg, #b48ce0, #f1ebf7)' },
  {
    value: 'system',
    label: '跟随系统',
    swatch: 'linear-gradient(90deg, #f5f5f5 0 50%, #1f1f1f 50% 100%)',
  },
];

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <section className="settings-section settings-panel__group">
      <h3 className="settings-section__title">{title}</h3>
      {children}
    </section>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (next: number) => void;
}

function Stepper({ label, value, min, max, unit = '分', onChange }: StepperProps): JSX.Element {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const longPressRef = useRef(false);
  const holdRef = useRef<{ delay: number | null; repeat: number | null }>({
    delay: null,
    repeat: null,
  });

  const clearHold = useCallback((): void => {
    if (holdRef.current.delay !== null) {
      window.clearTimeout(holdRef.current.delay);
      holdRef.current.delay = null;
    }
    if (holdRef.current.repeat !== null) {
      window.clearInterval(holdRef.current.repeat);
      holdRef.current.repeat = null;
    }
    // 等 click 事件消费完长按标记后再复位，避免误加一步
    window.setTimeout(() => {
      longPressRef.current = false;
    }, 0);
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const startHold = (delta: number): void => {
    clearHold();
    longPressRef.current = false;
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.delay = null;
      longPressRef.current = true;
      let next = clamp(valueRef.current + delta);
      onChangeRef.current(next);
      holdRef.current.repeat = window.setInterval(() => {
        next = clamp(next + delta);
        onChangeRef.current(next);
      }, 80);
    }, 450);
  };

  const handleClick = (delta: number): void => {
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    onChangeRef.current(clamp(valueRef.current + delta));
  };

  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`${label}减少`}
          onPointerDown={() => startHold(-1)}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onClick={() => handleClick(-1)}
        >
          <Icon name="minus" size={14} />
        </button>
        <span className="stepper__value">
          {value} {unit}
        </span>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`${label}增加`}
          onPointerDown={() => startHold(1)}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onClick={() => handleClick(1)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="setting-row setting-row--button"
      onClick={() => onChange(!checked)}
    >
      <span className="setting-row__label">{label}</span>
      <span
        className={checked ? 'toggle toggle--on' : 'toggle'}
        aria-hidden="true"
      >
        <span className="toggle__knob" />
      </span>
    </button>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeName;
  onChange: (next: ThemeName) => void;
}): JSX.Element {
  return (
    <div className="theme-picker" role="group" aria-label="视觉主题">
      {THEME_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            data-theme={option.value}
            aria-pressed={active}
            className={
              active ? 'theme-card theme-chip theme-chip--active' : 'theme-card theme-chip'
            }
            onClick={() => onChange(option.value)}
          >
            <span
              className="theme-card__swatch"
              style={{ background: option.swatch }}
              aria-hidden="true"
            />
            <span className="theme-card__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 更新状态文案：开发模式显示 idle.message，安装版按状态机给出下一步提示 */
function describeUpdate(status: UpdateStatus | null): string {
  if (status === null) {
    return '尚未检查更新';
  }
  switch (status.state) {
    case 'idle':
      return status.message ?? '尚未检查更新';
    case 'checking':
      return '正在检查更新…';
    case 'available':
      return `发现新版本 v${status.version ?? '?'}`;
    case 'not-available':
      return '已是最新版本';
    case 'downloading':
      return `正在下载 ${status.percent ?? 0}%`;
    case 'downloaded':
      return `v${status.version ?? '?'} 已下载，重启后安装`;
    case 'error':
      return `检查失败：${status.message ?? '未知错误'}`;
  }
}

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  updateStatus,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  history,
  dataMessage,
  onExportData,
  onImportData,
}: SettingsPanelProps): JSX.Element {
  return (
    <section className="settings-panel">
      <div className="settings-panel__scroll">
        <Section title="专注节奏">
          <Stepper
            label="专注时长"
            value={settings.focusMinutes}
            min={FOCUS_MIN}
            max={FOCUS_MAX}
            onChange={(next) => onUpdate({ focusMinutes: next })}
          />
          <Stepper
            label="短休时长"
            value={settings.shortBreakMinutes}
            min={BREAK_MIN}
            max={BREAK_MAX}
            onChange={(next) => onUpdate({ shortBreakMinutes: next })}
          />
          <Stepper
            label="长休时长"
            value={settings.longBreakMinutes}
            min={BREAK_MIN}
            max={BREAK_MAX}
            onChange={(next) => onUpdate({ longBreakMinutes: next })}
          />
          <Toggle
            label={`${settings.longBreakEvery} 个番茄后长休`}
            checked={settings.tieredBreakEnabled}
            onChange={(next) => onUpdate({ tieredBreakEnabled: next })}
          />
          {settings.tieredBreakEnabled && (
            <Stepper
              label="长休间隔"
              value={settings.longBreakEvery}
              min={EVERY_MIN}
              max={EVERY_MAX}
              unit="个"
              onChange={(next) => onUpdate({ longBreakEvery: next })}
            />
          )}
        </Section>

        <Section title="提醒">
          <div className="setting-row">
            <span className="setting-row__label">提示音音量</span>
            <span className="setting-row__value">{settings.volume}</span>
          </div>
          <input
            type="range"
            className="volume-slider"
            min={0}
            max={100}
            step={5}
            value={settings.volume}
            aria-label="提示音音量"
            onChange={(event) => onUpdate({ volume: Number(event.target.value) })}
          />
          <Toggle
            label="静音"
            checked={settings.muted}
            onChange={(next) => onUpdate({ muted: next })}
          />
          <Toggle
            label="勿扰模式（提醒仅视觉）"
            checked={settings.dndMode}
            onChange={(next) => onUpdate({ dndMode: next })}
          />
          <Toggle
            label="休息小贴士"
            checked={settings.showEyeCareTip}
            onChange={(next) => onUpdate({ showEyeCareTip: next })}
          />
          <Toggle
            label="20-20-20 护眼提醒"
            checked={settings.eyeCareEnabled}
            onChange={(next) => onUpdate({ eyeCareEnabled: next })}
          />
          {settings.eyeCareEnabled && (
            <Stepper
              label="护眼间隔"
              value={settings.eyeCareIntervalMinutes}
              min={EYE_MIN}
              max={EYE_MAX}
              onChange={(next) => onUpdate({ eyeCareIntervalMinutes: next })}
            />
          )}
          <Toggle
            label="久坐起身提醒"
            checked={settings.sedentaryEnabled}
            onChange={(next) => onUpdate({ sedentaryEnabled: next })}
          />
          {settings.sedentaryEnabled && (
            <Stepper
              label="久坐间隔"
              value={settings.sedentaryIntervalMinutes}
              min={SED_MIN}
              max={SED_MAX}
              onChange={(next) => onUpdate({ sedentaryIntervalMinutes: next })}
            />
          )}
        </Section>

        <Section title="外观">
          <ThemePicker
            value={settings.theme}
            onChange={(next) => onUpdate({ theme: next })}
          />
          <Toggle
            label="紧凑态鼠标穿透"
            checked={settings.compactClickThrough}
            onChange={(next) => onUpdate({ compactClickThrough: next })}
          />
          <p className="setting-row__hint">
            开启后紧凑窗不接收鼠标；双击托盘、托盘菜单「展开挂件」或按 Ctrl+Alt+P 展开。
          </p>
        </Section>

        <Section title="数据">
          <div className="setting-row">
            <span className="setting-row__label">近 7 天</span>
            <span className="setting-row__value">
              {history === null
                ? '—'
                : `${history.totalPomodoros} 个 · ${formatDurationMs(history.totalFocusMs)}`}
            </span>
          </div>
          <HistoryChart days={history?.days ?? []} />
          <div className="setting-row">
            <span className="setting-row__label">数据备份</span>
            <span className="setting-row__value">JSON</span>
          </div>
          <div className="update-actions">
            <button type="button" className="btn btn--ghost" onClick={onExportData}>
              导出备份
            </button>
            <button type="button" className="btn btn--ghost" onClick={onImportData}>
              导入备份
            </button>
          </div>
          {dataMessage !== null && <div className="update-status">{dataMessage}</div>}
        </Section>

        <Section title="关于">
          <Toggle
            label="开机自启"
            checked={settings.autoStartAtLogin}
            onChange={(next) => onUpdate({ autoStartAtLogin: next })}
          />
          <div className="setting-row">
            <span className="setting-row__label">当前版本</span>
            <span className="setting-row__value">v{updateStatus?.currentVersion ?? '—'}</span>
          </div>
          <div className="update-status">{describeUpdate(updateStatus)}</div>
          <div className="update-actions">
            {updateStatus?.state === 'available' && (
              <button type="button" className="btn btn--primary" onClick={onDownloadUpdate}>
                下载更新
              </button>
            )}
            {updateStatus?.state === 'downloaded' && (
              <button type="button" className="btn btn--primary" onClick={onInstallUpdate}>
                重启安装
              </button>
            )}
            {updateStatus?.state !== 'downloading' && updateStatus?.state !== 'downloaded' && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onCheckUpdate}
                disabled={updateStatus?.state === 'checking'}
              >
                检查更新
              </button>
            )}
          </div>
        </Section>
      </div>

      <footer className="settings-panel__footer">
        <button
          type="button"
          className="btn btn--primary settings-panel__done"
          onClick={onClose}
        >
          完成
        </button>
      </footer>
    </section>
  );
}
