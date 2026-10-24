/**
 * 提示音播放：Web Audio API 合成柔和短提示音（约 0.6s，正弦波 + 淡入淡出）。
 * 不依赖外部音频文件；尊重 muted/volume 与勿扰（quiet）；四类提醒音色区分（P1-1/P1-2）。
 * 禁止 Notification / 系统弹窗 / 语音。
 */
import type { RemindKind, Settings } from '../../shared/types';

interface ToneSpec {
  frequency: number;
  startAt: number;
  duration: number;
}

/** 专注结束：单音 A5，轻柔 */
const FOCUS_END_TONES: readonly ToneSpec[] = [{ frequency: 660, startAt: 0, duration: 0.55 }];

/** 休息结束：C5 -> E5 双音，柔和上行 */
const BREAK_END_TONES: readonly ToneSpec[] = [
  { frequency: 523.25, startAt: 0, duration: 0.32 },
  { frequency: 659.25, startAt: 0.18, duration: 0.42 },
];

/** 护眼提醒（20-20-20）：单音 E5，更轻 */
const EYE_CARE_TONES: readonly ToneSpec[] = [{ frequency: 659.25, startAt: 0, duration: 0.4 }];

/** 久坐提醒：单音 G4，低柔 */
const SEDENTARY_TONES: readonly ToneSpec[] = [{ frequency: 392, startAt: 0, duration: 0.5 }];

const TONES_BY_KIND: Record<RemindKind, readonly ToneSpec[]> = {
  focusEnd: FOCUS_END_TONES,
  breakEnd: BREAK_END_TONES,
  eyeCare: EYE_CARE_TONES,
  sedentary: SEDENTARY_TONES,
};

const PEAK_GAIN = 0.16;
const FLOOR_GAIN = 0.0001;

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (audioCtx === null) {
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/** 在首次用户手势时调用，规避自动播放策略 */
export function resumeAudio(): void {
  const ctx = getAudioContext();
  if (ctx !== null && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

/**
 * 播放到点提醒音。muted、volume=0 或 quiet（勿扰中）时完全静默。
 */
export function playRemind(
  kind: RemindKind,
  settings: Pick<Settings, 'muted' | 'volume'>,
  quiet = false
): void {
  if (quiet || settings.muted) {
    return;
  }
  const volume = Number.isFinite(settings.volume) ? Math.min(100, Math.max(0, settings.volume)) : 0;
  if (volume <= 0) {
    return;
  }
  const ctx = getAudioContext();
  if (ctx === null) {
    return;
  }
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  const tones = TONES_BY_KIND[kind] ?? FOCUS_END_TONES;
  const peak = PEAK_GAIN * (volume / 100);
  const t0 = ctx.currentTime + 0.02;
  for (const tone of tones) {
    scheduleTone(ctx, t0 + tone.startAt, tone.frequency, tone.duration, peak);
  }
}

function scheduleTone(
  ctx: AudioContext,
  startTime: number,
  frequency: number,
  duration: number,
  peak: number
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);

  const attack = Math.min(0.06, duration * 0.2);
  const release = Math.min(0.25, duration * 0.5);
  const sustainGain = Math.max(peak, FLOOR_GAIN * 2);

  gain.gain.setValueAtTime(FLOOR_GAIN, startTime);
  gain.gain.exponentialRampToValueAtTime(sustainGain, startTime + attack);
  gain.gain.setValueAtTime(sustainGain, startTime + duration - release);
  gain.gain.exponentialRampToValueAtTime(FLOOR_GAIN, startTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}
