import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import {
  all,
  any,
  collectRefs,
  consentIs,
  evaluate,
  flag,
  knows,
  learn,
  not,
  notYet,
  referencedFlags,
  setConsent,
  setFlag,
} from '../src/story/conditions';
import { StoryState, type StoryEvents } from '../src/story/StoryState';
import { resolveArea } from '../src/world/areas';
import { LOCATIONS } from '../src/world/layout';
import { TEST_DEFS } from './helpers/storyDefs';

function newState() {
  const bus = new EventBus<StoryEvents>();
  const log: string[] = [];
  bus.on('flagSet', ({ flag: f }) => log.push(`flag:${f}`));
  bus.on('topicLearned', ({ topic, stage, previous }) => log.push(`learn:${topic}/${stage}<-${previous}`));
  bus.on('consentChanged', ({ npc, request, status, previous }) => log.push(`consent:${npc}/${request}=${status}<-${previous}`));
  bus.on('npcMet', ({ npc }) => log.push(`met:${npc}`));
  bus.on('promiseRecorded', ({ id }) => log.push(`promise:${id}`));
  bus.on('storyRestored', () => log.push('restored'));
  return { state: new StoryState(TEST_DEFS, bus), log };
}

describe('条件', () => {
  it('フラグの有無・否定・すべて・いずれかを評価できる', () => {
    const { state } = newState();
    state.set('a');
    state.set('b');
    expect(evaluate(undefined, state)).toBe(true);
    expect(evaluate(flag('a'), state)).toBe(true);
    expect(evaluate(flag('c'), state)).toBe(false);
    expect(evaluate(not(flag('c')), state)).toBe(true);
    expect(evaluate(all(flag('a'), flag('b')), state)).toBe(true);
    expect(evaluate(all(flag('a'), flag('c')), state)).toBe(false);
    expect(evaluate(any(flag('c'), flag('b')), state)).toBe(true);
    expect(evaluate(any(flag('c'), not(flag('a'))), state)).toBe(false);
  });

  it('情報の段階で評価できる（知っている・その段階以上・まだその段階に達していない）', () => {
    const { state } = newState();
    expect(evaluate(knows('villager'), state)).toBe(false);
    expect(evaluate(notYet('villager', 'reason'), state)).toBe(true);
    state.learn('villager', 'refused');
    expect(evaluate(knows('villager'), state)).toBe(true);
    expect(evaluate(knows('villager', 'reason'), state)).toBe(false);
    expect(evaluate(notYet('villager', 'reason'), state)).toBe(true);
    state.learn('villager', 'reason');
    expect(evaluate(knows('villager', 'refused'), state)).toBe(true);
    expect(evaluate(knows('villager', 'reason'), state)).toBe(true);
    expect(evaluate(notYet('villager', 'reason'), state)).toBe(false);
    expect(evaluate(notYet('villager', 'alternative'), state)).toBe(true);
  });

  it('住民の現在の意向で評価できる（none はまだ聞いていない）', () => {
    const { state } = newState();
    expect(evaluate(consentIs('villager', 'help', 'none'), state)).toBe(true);
    state.setConsent('villager', 'help', 'declined');
    expect(evaluate(consentIs('villager', 'help', 'none'), state)).toBe(false);
    expect(evaluate(consentIs('villager', 'help', 'declined', 'conditional'), state)).toBe(true);
    expect(evaluate(consentIs('villager', 'lend', 'none'), state)).toBe(true);
  });

  it('参照しているフラグ・情報・意向を列挙できる', () => {
    const c = all(flag('a'), not(any(flag('b'), knows('villager', 'reason'))), consentIs('other', 'help', 'agreed'));
    expect(referencedFlags(c)).toEqual(['a', 'b']);
    const refs = collectRefs(c);
    expect(refs.topics).toEqual([{ topic: 'villager' }, { topic: 'villager', stage: 'reason' }]);
    expect(refs.consents).toEqual([{ npc: 'other', request: 'help' }]);
  });
});

describe('StoryState：フラグ', () => {
  it('新しく立ったときだけ記録・通知される', () => {
    const { state, log } = newState();
    expect(state.set('x')).toBe(true);
    expect(state.set('x')).toBe(false);
    state.apply([setFlag('y'), setFlag('x')]);
    expect(state.flagList()).toEqual(['x', 'y']);
    expect(log).toEqual(['flag:x', 'flag:y']);
  });
});

describe('StoryState：情報（手帳の基盤）', () => {
  it('段階的に更新され、以前の段階は経緯として残る', () => {
    const { state, log } = newState();
    expect(state.learn('villager', 'refused', { source: '村人と話した' })).toBe(true);
    expect(state.learn('villager', 'reason', { source: '畑を調べた後に聞いた' })).toBe(true);
    expect(state.currentStage('villager')).toBe('reason');
    expect(state.history('villager').map((h) => [h.stage, h.source])).toEqual([
      ['refused', '村人と話した'],
      ['reason', '畑を調べた後に聞いた'],
    ]);
    expect(log).toEqual(['learn:villager/refused<-null', 'learn:villager/reason<-refused']);
  });

  it('取得順序が違っても後退しない（後の段階を知った後に前の段階を得ても無視）', () => {
    const { state, log } = newState();
    state.learn('villager', 'reason');
    expect(state.learn('villager', 'refused')).toBe(false);
    expect(state.learn('villager', 'reason')).toBe(false);
    expect(state.currentStage('villager')).toBe('reason');
    expect(state.history('villager')).toHaveLength(1);
    expect(log).toEqual(['learn:villager/reason<-null']);
  });

  it('段階を飛ばして知ることもできる', () => {
    const { state } = newState();
    state.learn('villager', 'alternative');
    expect(state.topicRank('villager')).toBe(2);
  });

  it('定義にない情報・段階は受け付けない（データの誤りを早く見つける）', () => {
    const { state } = newState();
    expect(() => state.learn('nothing', 'x')).toThrow();
    expect(() => state.learn('villager', 'nothing')).toThrow();
  });

  it('得た順番がすべての情報を通して記録される', () => {
    const { state } = newState();
    state.learn('field', 'seen');
    state.set('f');
    state.learn('villager', 'refused');
    expect(state.allLearned().map((l) => l.topic)).toEqual(['field', 'villager']);
    const [a, b] = state.allLearned();
    expect(a!.order).toBeLessThan(b!.order);
  });
});

describe('StoryState：住民の状態', () => {
  it('会ったことと、依頼ごとの現在の意向・その履歴を持つ', () => {
    const { state, log } = newState();
    expect(state.hasMet('villager')).toBe(false);
    expect(state.markMet('villager')).toBe(true);
    expect(state.markMet('villager')).toBe(false);
    state.setConsent('villager', 'help', 'declined', '当日は無理');
    state.setConsent('villager', 'help', 'declined', '当日は無理'); // 同じ内容は記録しない
    state.setConsent('villager', 'help', 'conditional', '前日なら');
    state.setConsent('villager', 'lend', 'agreed');
    expect(state.consentStatus('villager', 'help')).toBe('conditional');
    expect(state.consent('villager', 'help')?.note).toBe('前日なら');
    expect(state.consentStatus('villager', 'lend')).toBe('agreed');
    expect(state.consentStatus('other', 'help')).toBeUndefined();
    expect(state.consentHistory('villager').map((c) => `${c.request}:${c.status}`)).toEqual([
      'help:declined',
      'help:conditional',
      'lend:agreed',
    ]);
    expect(log).toEqual([
      'met:villager',
      'consent:villager/help=declined<-null',
      'consent:villager/help=conditional<-declined',
      'consent:villager/lend=agreed<-null',
    ]);
  });

  it('定義にない住民・依頼は受け付けない', () => {
    const { state } = newState();
    expect(() => state.markMet('ghost')).toThrow();
    expect(() => state.setConsent('villager', 'nothing', 'agreed')).toThrow();
  });

  it('効果として意向・情報・約束を適用できる', () => {
    const { state } = newState();
    state.apply(
      [
        learn('villager', 'refused'),
        setConsent('villager', 'help', 'declined'),
        { type: 'recordPromise', id: 'p1', from: 'a', to: 'b', content: '後日手伝う' },
        { type: 'recordPromise', id: 'p1', from: 'a', to: 'b', content: '重複' },
      ],
      { source: 'テスト' },
    );
    expect(state.history('villager')[0]?.source).toBe('テスト');
    expect(state.consent('villager', 'help')?.source).toBe('テスト');
    expect(state.allPromises().map((p) => p.content)).toEqual(['後日手伝う']);
    expect(() => state.recordPromise('p2', 'a', 'zzz', 'x')).toThrow();
  });
});

describe('StoryState：保存と復元', () => {
  it('snapshot から完全に復元でき、続けて記録しても順番が保たれる', () => {
    const { state } = newState();
    state.set('f1');
    state.markMet('villager');
    state.learn('villager', 'refused', { source: 's1' });
    state.setConsent('villager', 'help', 'declined', 'n');
    state.learn('villager', 'reason');
    state.recordPromise('p', 'a', 'b', '約束');
    const snap = state.snapshot();

    const { state: other, log } = newState();
    other.restore(JSON.parse(JSON.stringify(snap)));
    expect(other.snapshot()).toEqual(snap);
    expect(other.history('villager').map((h) => h.stage)).toEqual(['refused', 'reason']);
    expect(other.hasMet('villager')).toBe(true);
    expect(log).toEqual(['restored']);
    other.learn('field', 'seen');
    expect(other.history('field')[0]!.order).toBeGreaterThan(snap.clock);
  });

  it('引数なしの restore で最初の状態に戻る', () => {
    const { state } = newState();
    state.set('f');
    state.learn('field', 'seen');
    state.markMet('other');
    state.restore();
    expect(state.snapshot()).toEqual({
      clock: 0,
      flags: [],
      learned: [],
      npcs: [],
      promises: [],
      chapter: 'ch1',
      plans: {},
    });
  });
});

describe('地点の判定（地点に入ったときのイベント用）', () => {
  it('最も近い地点を返し、遠すぎる場所ではどこでもない', () => {
    expect(resolveArea(null, { x: 0, z: 2 }, LOCATIONS)).toBe('saeHouse');
    expect(resolveArea(null, { x: 23, z: -5 }, LOCATIONS)).toBe('isukeHouse');
    expect(resolveArea(null, { x: 48, z: 38 }, LOCATIONS)).toBeNull();
  });

  it('境目では直前の地点を保ち、行き来しない', () => {
    expect(resolveArea('saeHouse', { x: 0, z: 8.5 }, LOCATIONS)).toBe('saeHouse');
    expect(resolveArea('southPlaza', { x: 0, z: 7.5 }, LOCATIONS)).toBe('southPlaza');
    expect(resolveArea('saeHouse', { x: 0, z: 12 }, LOCATIONS)).toBe('southPlaza');
  });
});
