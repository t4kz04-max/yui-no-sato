import { evaluate } from '../story/conditions';
import type { EffectContext, StoryState } from '../story/StoryState';
import type { DialogueChoice, DialogueNode, DialogueScript, NodeId, SpeakerId } from './types';

export interface DialogueChoiceView {
  readonly text: string;
}

/** UI に渡す現在の表示内容。 */
export interface DialogueView {
  readonly scriptId: string;
  readonly nodeId: NodeId;
  /** null は地の文。 */
  readonly speaker: SpeakerId | null;
  readonly text: string;
  readonly page: number;
  readonly pageCount: number;
  /** 空でなければ選択待ち（送りでは進まない）。 */
  readonly choices: readonly DialogueChoiceView[];
}

/**
 * 1回の会話の進行を管理する状態機械。DOM にも Three.js にも依存しない。
 * 条件の評価と効果の適用は StoryState に対して行う。
 */
export class DialogueRunner {
  private nodeId: NodeId | null = null;
  private page = 0;
  private choices: readonly DialogueChoice[] = [];

  constructor(
    readonly script: DialogueScript,
    private readonly state: StoryState,
    /** 効果を適用するときの文脈（手帳の「経緯」に出す入手元）。 */
    private readonly ctx: EffectContext = {},
  ) {
    const entry = script.entries.find((e) => evaluate(e.when, state));
    if (!entry) throw new Error(`会話 ${script.id} に成立する入口がありません`);
    this.enter(entry.node);
  }

  get finished(): boolean {
    return this.nodeId === null;
  }

  get view(): DialogueView | null {
    const node = this.currentNode();
    if (!node || this.nodeId === null) return null;
    const last = this.page === node.lines.length - 1;
    return {
      scriptId: this.script.id,
      nodeId: this.nodeId,
      speaker: node.speaker ?? null,
      text: node.lines[this.page] ?? '',
      page: this.page,
      pageCount: node.lines.length,
      choices: last ? this.choices.map((c) => ({ text: c.text })) : [],
    };
  }

  /** 次のページ・場面へ送る。選択待ちのときは何もせず false を返す。 */
  advance(): boolean {
    const node = this.currentNode();
    if (!node) return false;
    if (this.page < node.lines.length - 1) {
      this.page++;
      return true;
    }
    if (this.choices.length > 0) return false;
    this.go(node.next);
    return true;
  }

  /** 表示中の選択肢（view.choices の添字）を選ぶ。 */
  choose(index: number): boolean {
    const node = this.currentNode();
    if (!node || this.page !== node.lines.length - 1) return false;
    const choice = this.choices[index];
    if (!choice) return false;
    this.state.apply(choice.effects, this.ctx);
    this.go(choice.next);
    return true;
  }

  private currentNode(): DialogueNode | undefined {
    return this.nodeId === null ? undefined : this.script.nodes[this.nodeId];
  }

  private go(next: NodeId | undefined): void {
    if (next === undefined) {
      this.nodeId = null;
      this.choices = [];
      return;
    }
    this.enter(next);
  }

  private enter(id: NodeId): void {
    const node = this.script.nodes[id];
    if (!node) throw new Error(`会話 ${this.script.id} に場面 ${id} がありません`);
    this.nodeId = id;
    this.page = 0;
    this.state.apply(node.effects, this.ctx);
    // 効果を適用した後の状態で、表示する選択肢を決める。
    // 1つも表示できない場合は送りで会話を終える（行き止まりにしない。データ検証でも防ぐ）。
    this.choices = (node.choices ?? []).filter((c) => evaluate(c.when, this.state));
  }
}
