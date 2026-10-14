import { describe, expect, it } from 'vitest';
import { SAVE_FORMAT, SAVE_VERSION, createSave, parseSave } from '../src/save/saveData';
import { SaveStore, type KeyValueStorage } from '../src/save/SaveStore';
import { StoryState } from '../src/story/StoryState';
import { TEST_DEFS } from './helpers/storyDefs';

function sampleState(): StoryState {
  const s = new StoryState(TEST_DEFS);
  s.set('talked:villager');
  s.markMet('villager');
  s.learn('villager', 'refused', { source: '話した' });
  s.setConsent('villager', 'help', 'declined', '当日は無理', { source: '話した' });
  s.learn('villager', 'reason');
  s.recordPromise('p1', 'a', 'b', '後日手伝う');
  return s;
}

const player = { x: 1.5, z: -2.25, heading: 0.5 };

function json(value: unknown): string {
  return JSON.stringify(value);
}

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceeded');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('保存データ：書き出しと読み込み', () => {
  it('保存した状態を、同じ状態として読み込める', () => {
    const state = sampleState();
    const file = createSave(state.snapshot(), player, new Date('2026-10-14T09:00:00Z'));
    expect(file).toMatchObject({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: '2026-10-14T09:00:00.000Z' });
    const parsed = parseSave(json(file), TEST_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(parsed.save.player).toEqual(player);
    const restored = new StoryState(TEST_DEFS);
    restored.restore(parsed.save.story);
    expect(restored.snapshot()).toEqual(state.snapshot());
    expect(restored.consent('villager', 'help')).toMatchObject({ status: 'declined', note: '当日は無理', source: '話した' });
  });

  it('空のデータは「記録なし」として扱う', () => {
    expect(parseSave(null, TEST_DEFS)).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseSave('', TEST_DEFS)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it.each([
    ['JSON でない', '{"format":'],
    ['オブジェクトでない', '[1,2,3]'],
    ['形式名が違う', json({ format: 'other', version: 1 })],
    ['版番号がない', json({ format: SAVE_FORMAT })],
  ])('壊れたデータ（%s）は読み込まない', (_, text) => {
    expect(parseSave(text, TEST_DEFS)).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  it('必要な項目の型が違うデータは読み込まない', () => {
    const base = JSON.parse(json(createSave(sampleState().snapshot(), player)));
    const variants: Array<(d: any) => void> = [
      (d) => (d.player.x = 'a'),
      (d) => (d.player = null),
      (d) => (d.story.flags = 'x'),
      (d) => (d.story.learned[0].order = -1),
      (d) => (d.story.learned[0].topic = 3),
      (d) => (d.story.npcs[0].met = 'yes'),
      (d) => (d.story.npcs[0].consents[0].status = 'maybe'),
      (d) => delete d.story.promises,
      (d) => (d.story.clock = 1.5),
      (d) => (d.player.heading = null),
    ];
    for (const mutate of variants) {
      const d = JSON.parse(json(base));
      mutate(d);
      expect(parseSave(json(d), TEST_DEFS), String(mutate)).toMatchObject({ ok: false, reason: 'corrupt' });
    }
  });

  it('新しい版の記録は読み込まない', () => {
    const d = { ...createSave(sampleState().snapshot(), player), version: SAVE_VERSION + 1 };
    expect(parseSave(json(d), TEST_DEFS)).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('定義にない情報・住民・依頼・家は読み飛ばし、警告を返す（不整合の補正）', () => {
    const d = JSON.parse(json(createSave(sampleState().snapshot(), player)));
    d.story.learned.push({ topic: 'removedTopic', stage: 'x', order: 1 });
    d.story.learned.push({ topic: 'villager', stage: 'removedStage', order: 2 });
    d.story.npcs.push({ id: 'ghost', met: true, consents: [] });
    d.story.npcs[0].consents.push({ request: 'removedRequest', status: 'agreed', order: 3 });
    d.story.promises.push({ id: 'p9', from: 'a', to: 'nowhere', content: 'x', order: 4 });
    const parsed = parseSave(json(d), TEST_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toHaveLength(5);
    expect(parsed.save.story).toEqual(sampleState().snapshot());
  });

  it('情報の段階の順序が矛盾している記録は、その項目だけ読み飛ばす', () => {
    const d = JSON.parse(json(createSave(sampleState().snapshot(), player)));
    // 「理由が分かった」より後に「断られた」をもう一度得たことになっている
    d.story.learned.push({ topic: 'villager', stage: 'refused', order: 99 });
    d.story.clock = 99;
    const parsed = parseSave(json(d), TEST_DEFS);
    expect(parsed.ok && parsed.warnings.length).toBe(1);
    if (!parsed.ok) return;
    const restored = new StoryState(TEST_DEFS);
    restored.restore(parsed.save.story);
    expect(restored.currentStage('villager')).toBe('reason');
  });

  it('記録の順番が時計より進んでいたら時計を合わせ、以後の記録の順序を保つ', () => {
    const d = JSON.parse(json(createSave(sampleState().snapshot(), player)));
    d.story.clock = 0;
    const parsed = parseSave(json(d), TEST_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = new StoryState(TEST_DEFS);
    restored.restore(parsed.save.story);
    restored.learn('field', 'seen');
    const orders = restored.allLearned().map((l) => l.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('SaveStore（保存領域）', () => {
  it('保存・読込ができる', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, TEST_DEFS);
    expect(store.load()).toMatchObject({ ok: false, reason: 'empty' });
    expect(store.save(createSave(sampleState().snapshot(), player))).toBe(true);
    const loaded = store.load();
    expect(loaded.ok).toBe(true);
  });

  it('壊れた記録は消さずに別名で退避し、通常の保存先を空ける', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, TEST_DEFS);
    storage.setItem(store.key, '{broken');
    expect(store.load()).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(storage.getItem(store.corruptKey)).toBe('{broken');
    expect(storage.getItem(store.key)).toBeNull();
    // 退避した後は「記録なし」として新しく始められる
    expect(store.load()).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('保存領域が使えない・書き込めない環境でも例外を出さない', () => {
    const none = new SaveStore(null, TEST_DEFS);
    expect(none.load()).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(none.save(createSave(sampleState().snapshot(), player))).toBe(false);

    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(new SaveStore(storage, TEST_DEFS).save(createSave(sampleState().snapshot(), player))).toBe(false);

    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(new SaveStore(throwing, TEST_DEFS).load()).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
