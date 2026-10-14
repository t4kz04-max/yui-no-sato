import type { Vec2 } from '../core/math';
import type { FlagId } from '../story/conditions';
import type { LocationId } from '../world/layout';

/**
 * NPC と調査対象に共通のインタラクション定義。
 * どちらも「近づいて E を押すと、指定した会話データが始まる」という同じ仕組みで動く。
 */
interface InteractableBase {
  readonly id: string;
  /** 案内表示に出す名前（人物名・物の名前）。 */
  readonly label: string;
  /** 距離を測る基準点（XZ 平面）。 */
  readonly position: Vec2;
  /** この距離以内で操作できる。 */
  readonly range: number;
  /** content/dialogues の会話 ID。 */
  readonly dialogue: string;
  readonly location: LocationId;
}

export interface NpcInteractable extends InteractableBase {
  readonly kind: 'npc';
  /** content/characters の人物 ID。 */
  readonly character: string;
  /** 普段向いている方向（rotation.y）。 */
  readonly heading: number;
}

export interface ObjectInteractable extends InteractableBase {
  readonly kind: 'object';
  /** 案内表示を出す高さ（地面から）。 */
  readonly markerHeight: number;
}

export type Interactable = NpcInteractable | ObjectInteractable;

export const ACTION_LABEL: Record<Interactable['kind'], string> = {
  npc: '話す',
  object: '調べる',
};

/** 会話・調査を一度終えたときに自動で立つフラグ。 */
export function completionFlag(def: Interactable): FlagId {
  return def.kind === 'npc' ? `talked:${def.id}` : `inspected:${def.id}`;
}
