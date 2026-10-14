import type { InteractionEvents } from '../interaction/InteractionSystem';
import type { StoryEvents } from '../story/StoryState';
import type { LocationId } from '../world/layout';

/**
 * ゲーム内で発火するイベントの一覧。各系統は EventBus<GameEvents> を通して通知し合い、
 * 互いを直接参照しない。今後の章進行・演出などはここにイベントを追加して接続する。
 */
export interface GameEvents extends StoryEvents, InteractionEvents {
  /** プレイヤーが主要地点に入った。初回は `visited:<地点ID>` フラグも立つ。 */
  areaEntered: { readonly location: LocationId };
}
