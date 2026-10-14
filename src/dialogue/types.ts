import type { Condition, Effect } from '../story/conditions';

/**
 * 会話データの形式。会話の文章・分岐・条件はすべてこのデータに書き、
 * 3D 描画や UI のコードには埋め込まない。
 */

export type NodeId = string;
/** 話し手。content/characters.ts の人物 ID。省略すると地の文（調査の描写など）。 */
export type SpeakerId = string;

export interface DialogueChoice {
  readonly text: string;
  /** 表示条件。成立しないときは選択肢自体を出さない。 */
  readonly when?: Condition;
  readonly effects?: readonly Effect[];
  /** 選んだ後に進む場面。省略すると会話を終える。 */
  readonly next?: NodeId;
}

export interface DialogueNode {
  readonly speaker?: SpeakerId;
  /** 1要素が1ページ（送りで次のページへ）。 */
  readonly lines: readonly string[];
  /** この場面に入ったときに適用する効果。 */
  readonly effects?: readonly Effect[];
  /** 最後のページで示す選択肢。next とは併用しない。 */
  readonly choices?: readonly DialogueChoice[];
  /** 最後のページを送った後に進む場面。choices も next もなければ会話を終える。 */
  readonly next?: NodeId;
  /**
   * 最後のページを送った後、上から順に条件を調べ、最初に成立した場面へ進む（どれも成立しなければ next）。
   * 場面に入ったときの効果を適用した後の状態で判定する（例：相談の返事によって反応を変える）。choices とは併用しない。
   */
  readonly branches?: ReadonlyArray<{ readonly when: Condition; readonly next: NodeId }>;
}

export interface DialogueEntry {
  readonly when?: Condition;
  readonly node: NodeId;
}

export interface DialogueScript {
  readonly id: string;
  /** 会話の入口。上から順に条件を調べ、最初に成立したものから始める。最後は条件なしにする。 */
  readonly entries: readonly DialogueEntry[];
  readonly nodes: Readonly<Record<NodeId, DialogueNode>>;
}
