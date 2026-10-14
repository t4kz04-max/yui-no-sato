/**
 * 画面の状態（探索・会話・手帳・結帳・ポーズ・お知らせ）と、Esc／Tab などによる切り替え。
 * 純粋関数にしてテストし、入力の競合や抜け出せない状態が起きないことを確かめる。
 *
 * - 探索：Esc＝ポーズ、Tab＝手帳、E＝会話・調査
 * - 会話：Esc＝会話を中断（確定済みの選択は取り消さない）、Tab は無効
 * - 手帳：Esc／Tab＝閉じる
 * - 結帳：Esc＝閉じる、Tab＝手帳へ
 * - ポーズ：Esc＝再開
 * - お知らせ（続きから／最初から 等）：ボタンでのみ閉じる（Esc で誤って選ばないように）
 */
export type UiMode = 'explore' | 'dialogue' | 'notebook' | 'ledger' | 'pause' | 'notice';

export type UiAction =
  | 'esc'
  | 'tab'
  /** 会話・調査が始まった。 */
  | 'dialogueStarted'
  /** 会話・調査が終わった（中断を含む）。 */
  | 'dialogueEnded'
  | 'openLedger'
  | 'openNotebook'
  | 'openNotice'
  /** 画面の「閉じる」「再開」ボタン、またはお知らせへの回答。 */
  | 'close';

export function nextMode(mode: UiMode, action: UiAction): UiMode {
  switch (mode) {
    case 'explore':
      if (action === 'esc') return 'pause';
      if (action === 'tab' || action === 'openNotebook') return 'notebook';
      if (action === 'dialogueStarted') return 'dialogue';
      if (action === 'openLedger') return 'ledger';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'dialogue':
      // Esc は会話の中断要求。実際に中断されると dialogueEnded が届く
      if (action === 'dialogueEnded') return 'explore';
      return mode;
    case 'notebook':
      if (action === 'esc' || action === 'tab' || action === 'close') return 'explore';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'ledger':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'tab' || action === 'openNotebook') return 'notebook';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'pause':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'openNotebook') return 'notebook';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'notice':
      if (action === 'close') return 'explore';
      return mode;
  }
}

/** 探索の操作（移動・視点・E）を受け付けるか。 */
export function allowsExploration(mode: UiMode): boolean {
  return mode === 'explore';
}
