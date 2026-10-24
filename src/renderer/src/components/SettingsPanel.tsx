/**
 * SettingsPanel：基础设置面板（P0-5）。
 * 时长微调（专注/短休/长休）、音量/静音、开机自启、主题两选、护眼贴士、长休分档（P1-4 结构保留）。
 * 控件全部点按/滑杆（R2：focusable 切换由主进程窗口模式处理）。
 */
import type { Settings, ThemeName, UpdateStatus } from '../../../shared/types';

export interface SettingsPanelProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  updateStatus: UpdateStatus | null;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
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
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'minimal', label: '极简黑白' },
  { value: 'tomato', label: '番茄红' },
  { value: 'forest', label: '森林绿' },
  { value: 'ocean', label: '深海蓝' },
  { value: 'lavender', label: '薰衣草' },
  { value: 'system', label: '跟随系统' },
];

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}

function Stepper({ label, value, min, max, onChange }: StepperProps): JSX.Element {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`${label}减少`}
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </button>
        <span className="stepper__value">{value} 分</span>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`${label}增加`}
          onClick={() => onChange(clamp(value + 1))}
        >
          ＋
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
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? 'toggle toggle--on' : 'toggle'}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
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
}: SettingsPanelProps): JSX.Element {
  return (
    <section className="settings-panel">
      <h2 className="settings-panel__title">设置</h2>

      <div className="settings-panel__group">
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
            onChange={(next) => onUpdate({ longBreakEvery: next })}
          />
        )}
      </div>

      <div className="settings-panel__group">
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
      </div>

      <div className="settings-panel__group">
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
      </div>

      <div className="settings-panel__group">
        <Toggle
          label="开机自启"
          checked={settings.autoStartAtLogin}
          onChange={(next) => onUpdate({ autoStartAtLogin: next })}
        />
        <Toggle
          label="休息小贴士"
          checked={settings.showEyeCareTip}
          onChange={(next) => onUpdate({ showEyeCareTip: next })}
        />
        <Toggle
          label="勿扰模式（提醒仅视觉）"
          checked={settings.dndMode}
          onChange={(next) => onUpdate({ dndMode: next })}
        />
        <div className="setting-row">
          <span className="setting-row__label">视觉主题</span>
          <div className="theme-picker">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  settings.theme === option.value ? 'theme-chip theme-chip--active' : 'theme-chip'
                }
                onClick={() => onUpdate({ theme: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-panel__group">
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
      </div>

      <button type="button" className="btn btn--primary btn--wide settings-panel__done" onClick={onClose}>
        完成
      </button>
    </section>
  );
}
