/**
 * 初めて遊ぶ人向けの操作の手引き。まだ行っていない操作を、その操作が役に立つ場面で一つずつ短く案内する。
 * 行ったら二度と出さない（設定の hintsDone に記録する）。純粋関数にしてテストする。
 *
 * 物語の情報は出さない（何をすべきかは右上の目的表示に任せ、ここは操作だけ）。
 */
export type HintId = 'move' | 'look' | 'run' | 'talk' | 'notebook' | 'pause';

export interface HintDef {
  readonly id: HintId;
  readonly keys: readonly string[];
  readonly text: string;
}

export const HINTS: Readonly<Record<HintId, HintDef>> = {
  move: { id: 'move', keys: ['W', 'A', 'S', 'D'], text: 'で歩く' },
  look: { id: 'look', keys: ['ドラッグ'], text: 'で見回す（ホイールで寄る・離れる）' },
  run: { id: 'run', keys: ['Shift'], text: 'を押しながら歩くと走る' },
  talk: { id: 'talk', keys: ['E'], text: 'で話す・調べる' },
  notebook: { id: 'notebook', keys: ['Tab'], text: 'で手帳を開く（分かったことが書いてある）' },
  pause: { id: 'pause', keys: ['Esc'], text: 'でポーズ（設定・記録・操作の確認）' },
};

export interface HintContext {
  readonly done: ReadonlySet<string>;
  /** 探索の操作ができる状態か（会話・画面を開いている間は出さない）。 */
  readonly exploring: boolean;
  /** 話しかけられる人・調べられる物が近くにある。 */
  readonly hasTarget: boolean;
  /** 手帳に記録がある。 */
  readonly hasNotebookEntry: boolean;
  /** 遊び始めてからの探索の時間（秒）。 */
  readonly exploreTime: number;
}

/** 今出す手引き（なければ null）。 */
export function selectHint(c: HintContext): HintDef | null {
  if (!c.exploring) return null;
  const pending = (id: HintId) => !c.done.has(id);
  // 話せる相手が目の前にいるときは、それを優先する（最初の会話で迷わないように）
  if (c.hasTarget && pending('talk')) return HINTS.talk;
  if (pending('move')) return HINTS.move;
  if (pending('look')) return HINTS.look;
  if (pending('notebook') && c.hasNotebookEntry) return HINTS.notebook;
  if (pending('run') && c.exploreTime > 25) return HINTS.run;
  if (pending('pause') && c.done.has('notebook') && c.exploreTime > 60) return HINTS.pause;
  return null;
}
