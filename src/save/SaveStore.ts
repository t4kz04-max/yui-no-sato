import type { StoryDefinitions } from '../story/types';
import { parseSave, type ParseResult, type SaveFile } from './saveData';

/** localStorage と同じ形の保存領域（テストでは差し替える）。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEY = 'yui-no-yakusoku:save:1';

export type LoadResult = ParseResult | { readonly ok: false; readonly reason: 'unavailable'; readonly detail: string };

/**
 * 保存データの読み書き（1スロット）。保存領域が使えない環境（プライベートモード等）でも例外を外に出さない。
 * 壊れたデータは消さずに別名で退避し、通常の保存先は空けて新しく始められるようにする。
 */
export class SaveStore {
  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly defs: StoryDefinitions,
    readonly key: string = SAVE_KEY,
  ) {}

  get corruptKey(): string {
    return `${this.key}:corrupt`;
  }

  load(): LoadResult {
    if (!this.storage) return { ok: false, reason: 'unavailable', detail: '保存領域を使えません' };
    let text: string | null;
    try {
      text = this.storage.getItem(this.key);
    } catch {
      return { ok: false, reason: 'unavailable', detail: '保存領域を読めません' };
    }
    const result = parseSave(text, this.defs);
    if (!result.ok && (result.reason === 'corrupt' || result.reason === 'unsupported') && text !== null) {
      this.quarantine(text);
    }
    return result;
  }

  save(file: SaveFile): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(file));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // 消せなくても次の保存で上書きされる
    }
  }

  private quarantine(text: string): void {
    try {
      this.storage?.setItem(this.corruptKey, text);
      this.storage?.removeItem(this.key);
    } catch {
      // 退避できなくても読み込まないことに変わりはない
    }
  }
}

/** ブラウザの localStorage（使えない環境では null）。 */
export function browserStorage(): KeyValueStorage | null {
  try {
    const s = window.localStorage;
    const probe = '__yui_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
