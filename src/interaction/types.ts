import type { Vec2 } from '../core/math';
import type { FlagId } from '../story/types';
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
  /** 家の中（サエ家の室内）にあるもの。屋内にいるときだけ操作できる（Phase 5.5）。 */
  readonly indoor?: boolean;
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
  /** 調べ終えたときに開く専用画面（結帳など）。 */
  readonly opens?: 'ledger' | 'plan' | 'enterHouse' | 'leaveHouse';
  /** 案内表示の動詞（既定は「調べる」。入口は「入る」「出る」）。 */
  readonly action?: string;
  /**
   * 調べている間の観察の構図（Phase 6.5）：カメラの位置と、見る所（ワールド座標）。
   * 屋根のように高い所・広い物を、主人公の後ろからでは見きれないときに使う。
   */
  readonly view?: { readonly pos: { readonly x: number; readonly y: number; readonly z: number }; readonly look: { readonly x: number; readonly y: number; readonly z: number } };
  /** 案内表示を出す高さ（地面から）。 */
  readonly markerHeight: number;
}

export type Interactable = NpcInteractable | ObjectInteractable;

export const ACTION_LABEL: Record<Interactable['kind'], string> = {
  npc: '話す',
  object: '調べる',
};

/** 案内表示に出す動詞。 */
export function actionLabel(def: Interactable): string {
  return (def.kind === 'object' ? def.action : undefined) ?? ACTION_LABEL[def.kind];
}

/** 会話・調査を一度終えたときに自動で立つフラグ。 */
export function completionFlag(def: Interactable): FlagId {
  return def.kind === 'npc' ? `talked:${def.id}` : `inspected:${def.id}`;
}

/** 手帳の「経緯」に出す入手元の表記。 */
export function sourceLabel(def: Interactable): string {
  return def.kind === 'npc' ? `${def.label}と話した` : `${def.label}を調べた`;
}

/**
 * 案内表示の動詞と「済」（Phase 7・U06）。
 * - 出入口は「済」を付けない（調べたことと入ったことを混同しない。何度でも出入りする所）。
 * - サエ家の入口は、入る許しがない間は「調べる」（戸は閉まっている）、許しがあれば「入る」。
 */
export function promptState(def: Interactable, completed: boolean, houseOpen: boolean): { action: string; done: boolean } {
  if (def.kind === 'object' && def.opens === 'enterHouse') return { action: houseOpen ? actionLabel(def) : '調べる', done: false };
  if (def.kind === 'object' && def.opens === 'leaveHouse') return { action: actionLabel(def), done: false };
  return { action: actionLabel(def), done: completed };
}
