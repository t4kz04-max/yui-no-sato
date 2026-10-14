import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/content/characters';
import { LEDGER } from '../src/content/ledger';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { buildLedger, buildNotebook, type JournalSources } from '../src/journal/models';
import { StoryState } from '../src/story/StoryState';

const src: JournalSources = { characters: CHARACTERS, households: HOUSEHOLDS };

describe('手帳の表示内容', () => {
  it('最初は空で、会った住民だけが「人物」に載る', () => {
    const story = new StoryState(STORY_DEFS);
    let nb = buildNotebook(story, src);
    expect(nb.people).toEqual([]);
    expect(nb.known).toEqual([]);
    expect(nb.unconfirmed).toEqual([]);
    expect(nb.promises).toEqual([]);

    story.markMet('isuke');
    nb = buildNotebook(story, src);
    expect(nb.people.map((p) => p.name)).toEqual(['伊助']);
    expect(nb.people[0]?.consents).toEqual([]);
  });

  it('未確認から分かったことへ更新され、前の記述は「これまでの記録」に残る', () => {
    const story = new StoryState(STORY_DEFS);
    story.markMet('isuke');
    story.learn('isuke.availability', 'declined', { source: '伊助と話した' });
    let nb = buildNotebook(story, src);
    expect(nb.unconfirmed.map((t) => t.topic)).toEqual(['isuke.availability']);
    expect(nb.known).toEqual([]);

    story.learn('isuke.availability', 'harvest', { source: '伊助と話した' });
    nb = buildNotebook(story, src);
    expect(nb.unconfirmed).toEqual([]);
    const item = nb.known.find((t) => t.topic === 'isuke.availability')!;
    expect(item.text).toContain('刈り入れ');
    expect(item.personName).toBe('伊助');
    expect(item.history).toHaveLength(1);
    expect(item.history[0]).toMatchObject({ category: 'unconfirmed', source: '伊助と話した' });
    expect(item.history[0]!.text).toContain('理由はまだ分からない');
    // 人物の欄にも同じ情報が載る
    expect(nb.people[0]?.topics.map((t) => t.topic)).toEqual(['isuke.availability']);
  });

  it('住民の現在の意向と、その変化の履歴を表示できる', () => {
    const story = new StoryState(STORY_DEFS);
    story.markMet('mine');
    story.setConsent('mine', 'lendKaya', 'declined');
    story.setConsent('mine', 'lendKaya', 'conditional', '返し方がはっきりすれば');
    const person = buildNotebook(story, src).people[0]!;
    expect(person.consents).toEqual([
      {
        request: '茅の貸し出し',
        statusKey: 'conditional',
        status: '条件付き',
        note: '返し方がはっきりすれば',
        history: ['断っている'],
      },
    ]);
  });

  it('新しい記録ほど上に並び、最新の記録の順番が分かる（「新」の表示に使う）', () => {
    const story = new StoryState(STORY_DEFS);
    story.learn('sae.roof', 'worn');
    story.learn('sohei.roles', 'roles');
    const nb = buildNotebook(story, src);
    expect(nb.known.map((t) => t.topic)).toEqual(['sohei.roles', 'sae.roof']);
    expect(nb.latestOrder).toBe(nb.known[0]!.order);
  });
});

describe('結帳の表示内容（過去の記録と現在の状態の区別）', () => {
  it('過去の記録はいつでも同じ内容で、返しの状態を持つ（点数や合計はない）', () => {
    const before = buildLedger(new StoryState(STORY_DEFS), LEDGER, src);
    const l1 = before.entries.find((e) => e.id === 'L1')!;
    const isukeItem = l1.items.find((i) => i.id === 'L1-isuke')!;
    expect(isukeItem).toMatchObject({ from: '伊助家', to: 'サエ家', kind: '人手', settled: false });
    expect(Object.keys(isukeItem)).not.toContain('points');
  });

  it('関連して今わかっていることは、手帳で知っている情報だけを出す', () => {
    const story = new StoryState(STORY_DEFS);
    expect(buildLedger(story, LEDGER, src).entries[0]!.related).toEqual([]);
    story.learn('isuke.availability', 'declined');
    const related = buildLedger(story, LEDGER, src).entries[0]!.related;
    expect(related.map((r) => r.title)).toEqual(['伊助の当日の都合']);
  });

  it('関係する住民の現在の意向は、過去の記録とは別の欄に出し、記録から自動で決まらない', () => {
    const story = new StoryState(STORY_DEFS);
    let item = buildLedger(story, LEDGER, src).entries[0]!.items.find((i) => i.id === 'L1-isuke')!;
    // 過去に伊助家が手伝った記録があっても、本人の意向は「まだ聞いていない」
    expect(item.currentStance).toEqual([]);
    expect(story.consentStatus('isuke', 'roofDay')).toBeUndefined();

    story.setConsent('isuke', 'roofDay', 'declined', '当日は手伝えない');
    item = buildLedger(story, LEDGER, src).entries[0]!.items.find((i) => i.id === 'L1-isuke')!;
    expect(item.currentStance).toEqual(['伊助：屋根葺き当日の手伝いは「断っている」（当日は手伝えない）']);
    // 過去の記録の内容は変わらない
    expect(item.settled).toBe(false);
  });
});
