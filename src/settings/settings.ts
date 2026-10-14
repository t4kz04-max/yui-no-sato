import { clamp } from '../core/math';
import type { KeyValueStorage } from '../save/SaveStore';

/**
 * 遊び方の設定（視点の感度・音量・文字送りの速さ・操作の手引き）。
 * 進み具合の記録（SaveStore）とは別の保存領域に置き、「最初からやり直す」でも消さない。
 * DOM に依存しない（保存領域は差し替えられる）。
 */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

export interface Settings {
  /** 視点の感度（倍率。1＝標準）。 */
  readonly lookSensitivity: number;
  /** 視点の上下を反転する。 */
  readonly invertY: boolean;
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly ambientVolume: number;
  readonly sfxVolume: number;
  readonly muted: boolean;
  readonly textSpeed: TextSpeed;
  /** 初めて遊ぶ人向けの操作の手引き（まだ行っていない操作を一つずつ案内する）。 */
  readonly showHints: boolean;
  /** 左下の操作一覧。 */
  readonly showControls: boolean;
  /** 済ませた手引き（操作の手引きの ID）。 */
  readonly hintsDone: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  lookSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.45,
  ambientVolume: 0.7,
  sfxVolume: 0.75,
  muted: false,
  textSpeed: 'normal',
  showHints: true,
  showControls: true,
  hintsDone: [],
};

export const LOOK_SENSITIVITY_RANGE = { min: 0.4, max: 2.5 } as const;
export const TEXT_SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: 'ゆっくり', normal: 'ふつう', fast: '速い', instant: 'すぐに全文' };
/** 文字送りの速さ（1 秒あたりの文字数）。instant は一度に全文。 */
export const CHARS_PER_SECOND: Record<TextSpeed, number> = { slow: 25, normal: 45, fast: 80, instant: Infinity };

export const SETTINGS_KEY = 'yui-no-yakusoku:settings:1';

/** 保存されていた値を検証する。壊れた値・範囲外の値は既定値・範囲内に直す（設定で遊べなくならないように）。 */
export function parseSettings(text: string | null): Settings {
  if (!text) return DEFAULT_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const volume = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    lookSensitivity:
      typeof r.lookSensitivity === 'number' && Number.isFinite(r.lookSensitivity)
        ? clamp(r.lookSensitivity, LOOK_SENSITIVITY_RANGE.min, LOOK_SENSITIVITY_RANGE.max)
        : d.lookSensitivity,
    invertY: bool(r.invertY, d.invertY),
    masterVolume: volume(r.masterVolume, d.masterVolume),
    musicVolume: volume(r.musicVolume, d.musicVolume),
    ambientVolume: volume(r.ambientVolume, d.ambientVolume),
    sfxVolume: volume(r.sfxVolume, d.sfxVolume),
    muted: bool(r.muted, d.muted),
    textSpeed: TEXT_SPEEDS.includes(r.textSpeed as TextSpeed) ? (r.textSpeed as TextSpeed) : d.textSpeed,
    showHints: bool(r.showHints, d.showHints),
    showControls: bool(r.showControls, d.showControls),
    hintsDone: Array.isArray(r.hintsDone) ? [...new Set(r.hintsDone.filter((h): h is string => typeof h === 'string'))] : d.hintsDone,
  };
}

/** 設定の読み書き。保存できない環境でも例外を外に出さない（その回だけ反映される）。 */
export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly storage: KeyValueStorage | null,
    readonly key: string = SETTINGS_KEY,
  ) {
    let text: string | null = null;
    try {
      text = storage?.getItem(key) ?? null;
    } catch {
      text = null;
    }
    this.current = parseSettings(text);
  }

  get value(): Settings {
    return this.current;
  }

  /** 一部を変えて保存する。保存できたかを返す。 */
  update(patch: Partial<Settings>): boolean {
    this.current = parseSettings(JSON.stringify({ ...this.current, ...patch }));
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.current));
      return true;
    } catch {
      return false;
    }
  }
}

/** 音の種類ごとの最終的な音量（全体×種類、ミュートなら 0）。 */
export function effectiveVolumes(s: Settings): { music: number; ambient: number; sfx: number } {
  const m = s.muted ? 0 : s.masterVolume;
  return { music: m * s.musicVolume, ambient: m * s.ambientVolume, sfx: m * s.sfxVolume };
}
