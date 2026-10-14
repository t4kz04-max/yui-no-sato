import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { all, any, evaluate, flag, not, referencedFlags, setFlag } from '../src/story/conditions';
import { StoryState, type StoryEvents } from '../src/story/StoryState';
import { resolveArea } from '../src/world/areas';
import { LOCATIONS } from '../src/world/layout';

describe('条件', () => {
  const state = { has: (f: string) => f === 'a' || f === 'b' };

  it('フラグの有無・否定・すべて・いずれかを評価できる', () => {
    expect(evaluate(undefined, state)).toBe(true);
    expect(evaluate(flag('a'), state)).toBe(true);
    expect(evaluate(flag('c'), state)).toBe(false);
    expect(evaluate(not(flag('c')), state)).toBe(true);
    expect(evaluate(all(flag('a'), flag('b')), state)).toBe(true);
    expect(evaluate(all(flag('a'), flag('c')), state)).toBe(false);
    expect(evaluate(any(flag('c'), flag('b')), state)).toBe(true);
    expect(evaluate(any(flag('c'), not(flag('a'))), state)).toBe(false);
  });

  it('参照しているフラグを列挙できる', () => {
    expect(referencedFlags(all(flag('a'), not(any(flag('b'), flag('c')))))).toEqual(['a', 'b', 'c']);
    expect(referencedFlags(undefined)).toEqual([]);
  });
});

describe('StoryState', () => {
  it('フラグを立てると記録され、新しく立ったときだけ通知される', () => {
    const bus = new EventBus<StoryEvents>();
    const seen: string[] = [];
    bus.on('flagSet', ({ flag: f }) => seen.push(f));
    const s = new StoryState(bus);
    expect(s.has('x')).toBe(false);
    expect(s.set('x')).toBe(true);
    expect(s.set('x')).toBe(false);
    s.apply([setFlag('y'), setFlag('x')]);
    expect(s.has('x') && s.has('y')).toBe(true);
    expect(seen).toEqual(['x', 'y']);
    expect(s.snapshot()).toEqual(['x', 'y']);
  });

  it('購読を解除すると通知されない', () => {
    const bus = new EventBus<StoryEvents>();
    let count = 0;
    const off = bus.on('flagSet', () => count++);
    const s = new StoryState(bus);
    s.set('a');
    off();
    s.set('b');
    expect(count).toBe(1);
  });
});

describe('地点の判定（地点に入ったときのイベント用）', () => {
  it('最も近い地点を返し、遠すぎる場所ではどこでもない', () => {
    expect(resolveArea(null, { x: 0, z: 2 }, LOCATIONS)).toBe('saeHouse');
    expect(resolveArea(null, { x: 23, z: -5 }, LOCATIONS)).toBe('isukeHouse');
    expect(resolveArea(null, { x: 48, z: 38 }, LOCATIONS)).toBeNull();
  });

  it('境目では直前の地点を保ち、行き来しない', () => {
    // サエ家 (0,0) と広場 (0,16) の中間
    expect(resolveArea('saeHouse', { x: 0, z: 8.5 }, LOCATIONS)).toBe('saeHouse');
    expect(resolveArea('southPlaza', { x: 0, z: 7.5 }, LOCATIONS)).toBe('southPlaza');
    // 十分に近づけば切り替わる
    expect(resolveArea('saeHouse', { x: 0, z: 12 }, LOCATIONS)).toBe('southPlaza');
  });
});
