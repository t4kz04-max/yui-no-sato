import { describe, expect, it } from 'vitest';
import { DialogueRunner } from '../src/dialogue/DialogueRunner';
import type { DialogueScript } from '../src/dialogue/types';
import { validateScript } from '../src/dialogue/validate';
import { flag, setFlag } from '../src/story/conditions';
import { StoryState } from '../src/story/StoryState';
import { TEST_DEFS } from './helpers/storyDefs';

const SPEAKERS = new Set(['a', 'b']);

const script: DialogueScript = {
  id: 'test',
  entries: [{ when: flag('met'), node: 'again' }, { node: 'first' }],
  nodes: {
    first: {
      speaker: 'a',
      lines: ['1ページ目', '2ページ目'],
      effects: [setFlag('met')],
      choices: [
        { text: '聞く', next: 'answer', effects: [setFlag('asked')] },
        { text: '秘密を聞く', when: flag('clue'), next: 'secret' },
        { text: 'やめる' },
      ],
    },
    answer: { speaker: 'a', lines: ['答え'] },
    secret: { speaker: 'a', lines: ['秘密'], next: 'note' },
    note: { lines: ['（地の文）'], effects: [setFlag('knowsSecret')] },
    again: { speaker: 'a', lines: ['また来たね'] },
  },
};

describe('DialogueRunner', () => {
  it('ページを送り、選択肢は最後のページで出る', () => {
    const state = new StoryState(TEST_DEFS);
    const r = new DialogueRunner(script, state);
    expect(r.view).toMatchObject({ speaker: 'a', text: '1ページ目', page: 0, pageCount: 2, choices: [] });
    // 場面に入った時点で効果が適用される
    expect(state.has('met')).toBe(true);
    expect(r.advance()).toBe(true);
    expect(r.view?.text).toBe('2ページ目');
    // 条件を満たさない選択肢は出ない
    expect(r.view?.choices.map((c) => c.text)).toEqual(['聞く', 'やめる']);
    // 選択待ちでは送っても進まない
    expect(r.advance()).toBe(false);
    expect(r.view?.text).toBe('2ページ目');
  });

  it('選択肢を選ぶと効果が適用され、行き先へ進み、最後に終わる', () => {
    const state = new StoryState(TEST_DEFS);
    const r = new DialogueRunner(script, state);
    r.advance();
    expect(r.choose(0)).toBe(true);
    expect(state.has('asked')).toBe(true);
    expect(r.view?.text).toBe('答え');
    expect(r.finished).toBe(false);
    r.advance();
    expect(r.finished).toBe(true);
    expect(r.view).toBeNull();
    expect(r.advance()).toBe(false);
  });

  it('行き先のない選択肢を選ぶと会話が終わる', () => {
    const r = new DialogueRunner(script, new StoryState(TEST_DEFS));
    r.advance();
    r.choose(1); // 「やめる」（表示上の2番目）
    expect(r.finished).toBe(true);
  });

  it('状態によって入口と選択肢が変わる', () => {
    const state = new StoryState(TEST_DEFS);
    state.set('clue');
    const r = new DialogueRunner(script, state);
    r.advance();
    expect(r.view?.choices.map((c) => c.text)).toEqual(['聞く', '秘密を聞く', 'やめる']);
    r.choose(1);
    expect(r.view?.text).toBe('秘密');
    r.advance();
    expect(r.view).toMatchObject({ speaker: null, text: '（地の文）' });
    expect(state.has('knowsSecret')).toBe(true);
    r.advance();
    expect(r.finished).toBe(true);

    // 2回目は別の入口から始まる
    const again = new DialogueRunner(script, state);
    expect(again.view?.text).toBe('また来たね');
  });

  it('範囲外の選択や、ページ途中での選択は無視する', () => {
    const r = new DialogueRunner(script, new StoryState(TEST_DEFS));
    expect(r.choose(0)).toBe(false); // まだ1ページ目
    r.advance();
    expect(r.choose(5)).toBe(false);
    expect(r.view?.text).toBe('2ページ目');
  });
});

describe('会話データの検証', () => {
  it('正しいデータには問題がない', () => {
    expect(validateScript(script, SPEAKERS)).toEqual([]);
  });

  it('参照切れ・最後の入口の条件・未登録の話し手・到達不能な場面を検出する', () => {
    const bad: DialogueScript = {
      id: 'bad',
      entries: [{ when: flag('x'), node: 'start' }],
      nodes: {
        start: { speaker: 'nobody', lines: ['a'], next: 'missing' },
        orphan: { lines: ['b'] },
      },
    };
    const errors = validateScript(bad, SPEAKERS).join('\n');
    expect(errors).toMatch(/最後の入口に条件/);
    expect(errors).toMatch(/話し手 nobody/);
    expect(errors).toMatch(/next missing/);
    expect(errors).toMatch(/orphan にどこからも到達できない/);
  });

  it('抜け出せない循環と、すべて条件付きの選択肢を検出する', () => {
    const loop: DialogueScript = {
      id: 'loop',
      entries: [{ node: 'a' }],
      nodes: {
        a: { lines: ['a'], next: 'b' },
        b: { lines: ['b'], choices: [{ text: '戻る', next: 'a' }, { text: '出る', when: flag('never') }] },
      },
    };
    const errors = validateScript(loop, SPEAKERS).join('\n');
    expect(errors).toMatch(/場面 a から会話を終えられない/);
    expect(errors).toMatch(/場面 b から会話を終えられない/);

    const allConditional: DialogueScript = {
      id: 'cond',
      entries: [{ node: 'a' }],
      nodes: { a: { lines: ['a'], choices: [{ text: 'x', when: flag('f') }] } },
    };
    expect(validateScript(allConditional, SPEAKERS).join('\n')).toMatch(/すべて条件付き/);
  });

  it('空のページを検出する', () => {
    const empty: DialogueScript = { id: 'e', entries: [{ node: 'a' }], nodes: { a: { lines: [' '] } } };
    expect(validateScript(empty, SPEAKERS).join('\n')).toMatch(/空のページ/);
  });
});
