/**
 * 画面の状態（探索・会話・手帳・結帳・ポーズ・お知らせ など）と、Esc／Tab などによる切り替え。
 * 純粋関数にしてテストし、入力の競合や抜け出せない状態が起きないことを確かめる。
 *
 * - タイトル：はじめから／つづきから で探索へ。設定・史実と創作の解説を開ける。Esc では何も起きない
 * - 探索：Esc＝ポーズ、Tab＝手帳、E＝会話・調査
 * - 会話：Esc＝会話を中断（確定済みの選択は取り消さない）、Tab は無効
 * - 手帳：Esc／Tab＝閉じる
 * - 結帳：Esc＝閉じる、Tab＝手帳へ
 * - ポーズ：Esc＝再開。設定・選んだことの記録・史実と創作の解説を開ける
 * - お知らせ（はじめから の確認 等）：ボタンでのみ閉じる（Esc で誤って選ばないように）
 * - 作業台：Esc＝閉じる、Tab＝手帳へ（手帳と見比べて考えられるように）
 * - 結果・エンディング：Esc・閉じるで村に戻る（決定はすでに確定しているので、閉じても何も失われない）。選んだことの記録を開ける
 * - 設定・選んだことの記録・史実と創作の解説：Esc・閉じるで閉じる（開いた元の画面に戻すのは Game が行う）
 * - 時間の経過（暗転して「三年後」など）：決定キー・クリックで進み、最後に村へ
 * - 短いカメラ演出（屋根葺きの日の見渡し）：数秒で終わる。決定キー・Esc で飛ばせる
 */
export type UiMode =
  | 'title'
  | 'explore'
  | 'dialogue'
  | 'notebook'
  | 'ledger'
  | 'plan'
  | 'result'
  | 'ending'
  | 'explain'
  | 'settings'
  | 'history'
  | 'pause'
  | 'notice'
  | 'transition'
  | 'cinematic';

export type UiAction =
  | 'esc'
  | 'tab'
  /** 会話・調査が始まった。 */
  | 'dialogueStarted'
  /** 会話・調査が終わった（中断を含む）。 */
  | 'dialogueEnded'
  | 'openTitle'
  | 'openPause'
  | 'openLedger'
  | 'openPlan'
  | 'openResult'
  | 'openEnding'
  | 'openExplain'
  | 'openSettings'
  | 'openHistory'
  | 'openNotebook'
  | 'openNotice'
  | 'openTransition'
  | 'openCinematic'
  /** 画面の「閉じる」「再開」ボタン、お知らせへの回答、時間経過・演出の終わり。 */
  | 'close';

export function nextMode(mode: UiMode, action: UiAction): UiMode {
  switch (mode) {
    case 'title':
      if (action === 'close') return 'explore';
      if (action === 'openSettings') return 'settings';
      if (action === 'openExplain') return 'explain';
      if (action === 'openNotice') return 'notice';
      if (action === 'openTransition') return 'transition';
      return mode;
    case 'explore':
      if (action === 'esc' || action === 'openPause') return 'pause';
      if (action === 'tab' || action === 'openNotebook') return 'notebook';
      if (action === 'dialogueStarted') return 'dialogue';
      if (action === 'openTitle') return 'title';
      if (action === 'openLedger') return 'ledger';
      if (action === 'openPlan') return 'plan';
      if (action === 'openResult') return 'result';
      if (action === 'openEnding') return 'ending';
      if (action === 'openNotice') return 'notice';
      if (action === 'openTransition') return 'transition';
      if (action === 'openCinematic') return 'cinematic';
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
    case 'plan':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'tab' || action === 'openNotebook') return 'notebook';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'result':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'openHistory') return 'history';
      return mode;
    case 'ending':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'openExplain') return 'explain';
      if (action === 'openHistory') return 'history';
      return mode;
    case 'explain':
    case 'settings':
    case 'history':
      if (action === 'esc' || action === 'close') return 'explore';
      return mode;
    case 'pause':
      if (action === 'esc' || action === 'close') return 'explore';
      if (action === 'openNotebook') return 'notebook';
      if (action === 'openExplain') return 'explain';
      if (action === 'openSettings') return 'settings';
      if (action === 'openHistory') return 'history';
      if (action === 'openNotice') return 'notice';
      return mode;
    case 'notice':
      if (action === 'close') return 'explore';
      return mode;
    case 'transition':
      if (action === 'close') return 'explore';
      return mode;
    case 'cinematic':
      if (action === 'esc' || action === 'close') return 'explore';
      return mode;
  }
}

/** 探索の操作（移動・視点・E）を受け付けるか。 */
export function allowsExploration(mode: UiMode): boolean {
  return mode === 'explore';
}

/** 閉じたら開いた元の画面に戻す画面（設定・記録・解説）と、戻すときの操作。 */
export const RETURN_ACTION: Partial<Record<UiMode, UiAction>> = {
  title: 'openTitle',
  pause: 'openPause',
  result: 'openResult',
  ending: 'openEnding',
};
