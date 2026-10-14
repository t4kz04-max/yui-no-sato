import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { DialogueScript } from '../src/dialogue/types';
import { InteractionSystem, type InteractionEvents } from '../src/interaction/InteractionSystem';
import { findTarget } from '../src/interaction/targeting';
import type { Interactable } from '../src/interaction/types';
import { flag } from '../src/story/conditions';
import { StoryState } from '../src/story/StoryState';

const npc = (id: string, x: number, z: number, range = 2.5): Interactable => ({
  kind: 'npc',
  id,
  character: id,
  label: id,
  dialogue: id,
  location: 'southPlaza',
  position: { x, z },
  heading: 0,
  range,
});
const obj = (id: string, x: number, z: number, range = 2.5): Interactable => ({
  kind: 'object',
  id,
  label: id,
  dialogue: id,
  location: 'southPlaza',
  position: { x, z },
  range,
  markerHeight: 1,
});

// heading 0 は +Z を向く
const facingPlusZ = { x: 0, z: 0, heading: 0 };

describe('操作対象の選択', () => {
  it('範囲内で正面にある対象を選び、範囲外は選ばない', () => {
    const a = npc('a', 0, 2);
    const far = npc('far', 0, 4);
    expect(findTarget(facingPlusZ, [a, far])?.id).toBe('a');
    expect(findTarget(facingPlusZ, [far])).toBeNull();
  });

  it('背後にある対象は選ばない（ただしすぐ近くなら選べる）', () => {
    expect(findTarget(facingPlusZ, [npc('behind', 0, -2)])).toBeNull();
    expect(findTarget(facingPlusZ, [npc('close', 0, -1)])?.id).toBe('close');
  });

  it('同じ距離なら正面に近い方を選ぶ', () => {
    const front = npc('front', 0, 2);
    const side = npc('side', 2, 0.3);
    expect(findTarget(facingPlusZ, [side, front])?.id).toBe('front');
  });

  it('僅差なら直前の対象を保ち、表示がちらつかない', () => {
    const a = npc('a', -0.3, 2);
    const b = npc('b', 0.3, 2.05);
    expect(findTarget(facingPlusZ, [a, b])?.id).toBe('a');
    expect(findTarget(facingPlusZ, [a, b], 'b')?.id).toBe('b');
    // 大きく差があれば切り替わる
    expect(findTarget(facingPlusZ, [a, npc('b', 0, 0.6)], 'a')?.id).toBe('b');
  });
});

const dialogues: Record<string, DialogueScript> = {
  villager: {
    id: 'villager',
    entries: [{ node: 'first' }],
    nodes: {
      first: {
        speaker: 'villager',
        lines: ['こんにちは', '何か用？'],
        choices: [
          { text: '畑のこと', when: flag('inspected:field'), next: 'field' },
          { text: '別に' },
          { text: '天気のこと', next: 'weather' },
        ],
      },
      field: { speaker: 'villager', lines: ['見たのか'] },
      weather: { speaker: 'villager', lines: ['いい天気だ'] },
    },
  },
  field: { id: 'field', entries: [{ node: 'a' }], nodes: { a: { lines: ['稲が掛かっている'] } } },
};

function setup() {
  const bus = new EventBus<InteractionEvents>();
  const log: string[] = [];
  bus.on('interactionStarted', ({ id }) => log.push(`start:${id}`));
  bus.on('interactionEnded', ({ id }) => log.push(`end:${id}`));
  const story = new StoryState();
  const villager = { ...npc('villager', 0, 2), dialogue: 'villager' };
  const field = { ...obj('field', 10, 2), dialogue: 'field' };
  const sys = new InteractionSystem([villager, field], dialogues, story, bus);
  return { sys, story, log };
}

describe('InteractionSystem', () => {
  it('近づいて会話を始め、送り、選び、終えて探索に戻れる', () => {
    const { sys, story, log } = setup();
    sys.updateTarget({ x: 0, z: 10, heading: Math.PI });
    expect(sys.target).toBeNull();
    expect(sys.interact()).toBe(false);

    sys.updateTarget(facingPlusZ);
    expect(sys.target?.id).toBe('villager');
    expect(sys.interact()).toBe(true);
    expect(sys.isActive).toBe(true);
    expect(sys.partner?.id).toBe('villager');
    // 会話中は新しい対象を選ばない
    expect(sys.target).toBeNull();
    expect(sys.interact()).toBe(false);

    expect(sys.view?.text).toBe('こんにちは');
    sys.confirm();
    expect(sys.view?.choices.map((c) => c.text)).toEqual(['別に', '天気のこと']);
    sys.moveSelection(1);
    expect(sys.selected).toBe(1);
    sys.moveSelection(1); // 端で折り返す
    expect(sys.selected).toBe(0);
    sys.moveSelection(-1);
    sys.confirm(); // 「天気のこと」
    expect(sys.view?.text).toBe('いい天気だ');
    sys.confirm();

    expect(sys.isActive).toBe(false);
    expect(sys.view).toBeNull();
    expect(story.has('talked:villager')).toBe(true);
    expect(log).toEqual(['start:villager', 'end:villager']);
    // 終了後は再び対象を選べる
    sys.updateTarget(facingPlusZ);
    expect(sys.target?.id).toBe('villager');
    expect(sys.isCompleted(sys.target!)).toBe(true);
  });

  it('調査すると状態に記録され、会話の選択肢が増える', () => {
    const { sys, story } = setup();
    sys.updateTarget({ x: 10, z: 0, heading: 0 });
    expect(sys.target?.id).toBe('field');
    sys.interact();
    expect(sys.view).toMatchObject({ speaker: null, text: '稲が掛かっている' });
    sys.advance();
    expect(sys.isActive).toBe(false);
    expect(story.has('inspected:field')).toBe(true);

    sys.updateTarget(facingPlusZ);
    sys.interact();
    sys.advance();
    expect(sys.view?.choices.map((c) => c.text)).toEqual(['畑のこと', '別に', '天気のこと']);
    sys.choose(0);
    expect(sys.view?.text).toBe('見たのか');
  });

  it('選択待ちのときクリック相当の送りでは進まない', () => {
    const { sys } = setup();
    sys.updateTarget(facingPlusZ);
    sys.interact();
    sys.advance();
    expect(sys.advance()).toBe(false);
    expect(sys.isActive).toBe(true);
    sys.select(1);
    expect(sys.selected).toBe(1);
    sys.select(9); // 範囲外は無視
    expect(sys.selected).toBe(1);
  });
});
