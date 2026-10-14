import type { EventSink } from '../core/EventBus';
import { DialogueRunner, type DialogueView } from '../dialogue/DialogueRunner';
import type { DialogueScript } from '../dialogue/types';
import type { StoryState } from '../story/StoryState';
import { findTarget, type Pose } from './targeting';
import { completionFlag, type Interactable } from './types';

export interface InteractionEvents {
  interactionStarted: { readonly id: string };
  interactionEnded: { readonly id: string };
}

/**
 * 探索中の「近くの対象を選ぶ → E で会話・調査を始める → 進める → 終えて探索に戻る」を管理する。
 * DOM にも Three.js にも依存しない（UI と 3D 表示は Game が view を読んで反映する）。
 */
export class InteractionSystem {
  private targetDef: Interactable | null = null;
  private active: { readonly target: Interactable; readonly runner: DialogueRunner } | null = null;
  private selectedIndex = 0;

  constructor(
    readonly interactables: readonly Interactable[],
    private readonly dialogues: Readonly<Record<string, DialogueScript>>,
    private readonly story: StoryState,
    private readonly events?: EventSink<InteractionEvents>,
  ) {}

  /** 探索中に操作できる対象（会話中は null）。 */
  get target(): Interactable | null {
    return this.active ? null : this.targetDef;
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  /** 会話・調査中の相手。 */
  get partner(): Interactable | null {
    return this.active?.target ?? null;
  }

  get view(): DialogueView | null {
    return this.active?.runner.view ?? null;
  }

  /** 選択肢を出しているときの、選択中の添字。 */
  get selected(): number {
    return this.selectedIndex;
  }

  /** その対象との会話・調査を一度でも終えたか。 */
  isCompleted(def: Interactable): boolean {
    return this.story.has(completionFlag(def));
  }

  updateTarget(pose: Pose): void {
    if (this.active) return;
    this.targetDef = findTarget(pose, this.interactables, this.targetDef?.id ?? null);
  }

  /** 対象があれば会話・調査を始める。 */
  interact(): boolean {
    const target = this.target;
    if (!target) return false;
    const script = this.dialogues[target.dialogue];
    if (!script) throw new Error(`会話データ ${target.dialogue} がありません（${target.id}）`);
    this.active = { target, runner: new DialogueRunner(script, this.story) };
    this.selectedIndex = 0;
    this.events?.emit('interactionStarted', { id: target.id });
    this.finishIfDone();
    return true;
  }

  /** 送る（選択待ちのときは何もしない）。クリックでの送りに使う。 */
  advance(): boolean {
    if (!this.active) return false;
    const moved = this.active.runner.advance();
    this.afterStep();
    return moved;
  }

  /** 決定キー：選択待ちなら選択中の項目を選び、そうでなければ送る。 */
  confirm(): boolean {
    const view = this.view;
    if (!view) return false;
    return view.choices.length > 0 ? this.choose(this.selectedIndex) : this.advance();
  }

  choose(index: number): boolean {
    if (!this.active) return false;
    const ok = this.active.runner.choose(index);
    this.afterStep();
    return ok;
  }

  select(index: number): void {
    const count = this.view?.choices.length ?? 0;
    if (index >= 0 && index < count) this.selectedIndex = index;
  }

  moveSelection(delta: number): void {
    const count = this.view?.choices.length ?? 0;
    if (count === 0) return;
    this.selectedIndex = (((this.selectedIndex + delta) % count) + count) % count;
  }

  private afterStep(): void {
    this.selectedIndex = 0;
    this.finishIfDone();
  }

  private finishIfDone(): void {
    if (!this.active || !this.active.runner.finished) return;
    const { target } = this.active;
    this.active = null;
    this.story.set(completionFlag(target));
    this.events?.emit('interactionEnded', { id: target.id });
  }
}
