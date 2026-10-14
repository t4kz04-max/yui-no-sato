import type { EventSink } from '../core/EventBus';
import type { Effect, FlagId, FlagReader } from './conditions';

export interface StoryEvents {
  /** フラグが新しく立った（既に立っていた場合は通知しない）。 */
  flagSet: { readonly flag: FlagId };
}

/**
 * プレイヤーが知ったこと・行ったことの記録（ゲーム状態）。3D 描画にも DOM にも依存しない。
 *
 * Phase 1 では会話・調査の結果をフラグとして保持するだけの最小構成。
 * NPC ごとの状態・結帳・セーブなどは Phase 2 でここを拡張する。
 */
export class StoryState implements FlagReader {
  private readonly flags = new Set<FlagId>();

  constructor(private readonly events?: EventSink<StoryEvents>) {}

  has(flag: FlagId): boolean {
    return this.flags.has(flag);
  }

  /** 新しく立ったときだけ true を返す。 */
  set(flag: FlagId): boolean {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    this.events?.emit('flagSet', { flag });
    return true;
  }

  apply(effects: readonly Effect[] | undefined): void {
    if (!effects) return;
    for (const effect of effects) {
      switch (effect.type) {
        case 'setFlag':
          this.set(effect.flag);
          break;
      }
    }
  }

  /** 立っているフラグの一覧（立った順）。デバッグ表示・テスト用。 */
  snapshot(): FlagId[] {
    return [...this.flags];
  }
}
