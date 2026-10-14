import { describe, expect, it } from 'vitest';
import { allowsExploration, nextMode, type UiAction, type UiMode } from '../src/game/modes';

const MODES: UiMode[] = ['explore', 'dialogue', 'notebook', 'ledger', 'plan', 'result', 'pause', 'notice'];
const ACTIONS: UiAction[] = [
  'esc',
  'tab',
  'dialogueStarted',
  'dialogueEnded',
  'openLedger',
  'openPlan',
  'openResult',
  'openNotebook',
  'openNotice',
  'close',
];

describe('画面の状態遷移（Esc・Tab の競合と進行不能の防止）', () => {
  it('探索：Esc でポーズ、Tab で手帳、会話開始で会話', () => {
    expect(nextMode('explore', 'esc')).toBe('pause');
    expect(nextMode('explore', 'tab')).toBe('notebook');
    expect(nextMode('explore', 'dialogueStarted')).toBe('dialogue');
  });

  it('会話中：Esc・Tab では画面が変わらない（Esc は会話の中断要求として別に処理し、中断されると探索に戻る）', () => {
    expect(nextMode('dialogue', 'esc')).toBe('dialogue');
    expect(nextMode('dialogue', 'tab')).toBe('dialogue');
    expect(nextMode('dialogue', 'openNotebook')).toBe('dialogue');
    expect(nextMode('dialogue', 'openNotice')).toBe('dialogue');
    expect(nextMode('dialogue', 'dialogueEnded')).toBe('explore');
  });

  it('手帳・結帳・ポーズは Esc で探索に戻る。手帳は Tab でも閉じる', () => {
    expect(nextMode('notebook', 'esc')).toBe('explore');
    expect(nextMode('notebook', 'tab')).toBe('explore');
    expect(nextMode('ledger', 'esc')).toBe('explore');
    expect(nextMode('ledger', 'tab')).toBe('notebook');
    expect(nextMode('pause', 'esc')).toBe('explore');
    expect(nextMode('pause', 'openNotebook')).toBe('notebook');
  });

  it('作業台：Esc で閉じ、Tab で手帳と見比べられる。決定の確認はお知らせで行う', () => {
    expect(nextMode('explore', 'openPlan')).toBe('plan');
    expect(nextMode('plan', 'esc')).toBe('explore');
    expect(nextMode('plan', 'tab')).toBe('notebook');
    expect(nextMode('plan', 'openNotice')).toBe('notice');
    expect(nextMode('plan', 'dialogueStarted')).toBe('plan');
    expect(nextMode('explore', 'openResult')).toBe('result');
    expect(nextMode('result', 'close')).toBe('explore');
    expect(nextMode('result', 'tab')).toBe('result');
  });

  it('お知らせは Esc・Tab で閉じない（回答を選んだときだけ閉じる）', () => {
    expect(nextMode('notice', 'esc')).toBe('notice');
    expect(nextMode('notice', 'tab')).toBe('notice');
    expect(nextMode('notice', 'close')).toBe('explore');
  });

  it('会話の開始は探索中だけ（手帳やポーズの裏で会話が始まらない）', () => {
    for (const m of MODES.filter((m) => m !== 'explore')) expect(nextMode(m, 'dialogueStarted')).toBe(m);
  });

  it('どの画面からでも、決められた操作で探索に戻れる（抜け出せない画面がない）', () => {
    for (const start of MODES) {
      // 幅優先探索で explore に到達できるか
      const seen = new Set<UiMode>([start]);
      const queue: UiMode[] = [start];
      while (queue.length > 0) {
        const m = queue.shift()!;
        for (const a of ACTIONS) {
          const n = nextMode(m, a);
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(seen.has('explore'), start).toBe(true);
    }
  });

  it('探索の操作（移動・視点・E）を受け付けるのは探索中だけ', () => {
    expect(MODES.filter(allowsExploration)).toEqual(['explore']);
  });
});
