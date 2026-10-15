import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { collectLicenses, licensesText } from '../build/licenses.mjs';
import { MUSIC_MAX_NOTES_PER_UPDATE, scheduleMusic, type MusicClock } from '../src/audio/musicScheduler';
import { createPersonRig, disposePersonRig } from '../src/characters/personRig';
import { CHARACTERS, VILLAGER_LOOKS } from '../src/content/characters';
import { PROMISES_KEPT_BY_CH3, PROMISE_ISUKE_HELPS_SAE_REST, derivedPromises, ledgerEntries } from '../src/content/chronicle';
import { LEDGER } from '../src/content/ledger';
import { OUTCOME_IDS, parseOutcomeId } from '../src/content/plan';
import { ENDINGS, PLAN3_ITEMS } from '../src/content/plan3';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { NoticeQueue } from '../src/game/noticeQueue';
import { buildLedger, buildNotebook, type JournalSources } from '../src/journal/models';
import { shownLines } from '../src/journal/planModels';
import { StoryState } from '../src/story/StoryState';
import type { PlanSpec } from '../src/story/types';
import { ToastQueue, type ToastItem } from '../src/ui/toastQueue';

/**
 * Phase 7 最終品質改善：独立コードレビューの指摘（docs/PHASE7_PLAN.md §7）。
 * #1（結果画面からの復元）は scripts/browser-resume.mjs（全 8 案）で確かめる。
 */

const PLANS: Record<string, PlanSpec> = {
  'solo-full': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'solo-part': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'prep-full': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'prep-part': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'wait-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
  'wait-part': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'mineCovers' },
  'waitHelp-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
  'waitHelp-part': { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'mineCovers' },
};
const PLAN3: Record<string, PlanSpec> = {
  e1: { timing: 'now', saeHelp: 'ground' },
  e2: { timing: 'now', saeHelp: 'none' },
  e3: { timing: 'nextYear', saeHelp: 'none' },
};
const SRC: JournalSources = { characters: CHARACTERS, households: HOUSEHOLDS, derivedPromises };

function knowingAll(s: StoryState) {
  for (const [t, v] of [
    ['sae.schedule', 'needsHelp'], ['sae.dateReason', 'burden'], ['sae.roof', 'worn'], ['sae.kaya', 'short'],
    ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'], ['isuke.pastHelp', 'isukeView'],
    ['sohei.schedule', 'kayaCutting'], ['mine.kaya', 'whyRecord'], ['mine.cutting', 'canLead'], ['ledger.basics', 'read'],
  ] as const) s.learn(t, v);
}
function decide(s: StoryState, plan: PlanSpec): string | null {
  s.setPlanDraft(plan);
  for (const npc of s.planInvolved()) s.consultPlan(npc);
  return s.decidePlan();
}
function endRoofDay(s: StoryState) {
  s.learn('sae.roof', s.planDecision('roof')!.outcome.endsWith('-full') ? 'renewed' : 'partial');
  s.set('roofDay:ended');
}
function toChapter3(s: StoryState) {
  endRoofDay(s);
  for (const id of PROMISES_KEPT_BY_CH3) if (s.allPromises().some((p) => p.id === id)) s.set(`kept:${id}`);
  s.setChapter('ch3');
  s.learn('isuke.roof3', 'needsRoof');
  s.learn('sae.later', 'injured');
}

// ───────── 2：通知の表示待ち ─────────

describe('通知の表示待ち（指摘 2）：あふれても消さず、順に一度ずつ出す', () => {
  const run = (q: ToastQueue, seconds: number, paused = false) => {
    const shown: string[] = [];
    for (let t = 0; t < seconds; t += 1 / 30) shown.push(...q.tick(1 / 30, paused).shown.map((x) => x.text));
    return shown;
  };

  it('3 件以上を一度に追加しても、2 件ずつ順に、すべて一度ずつ出る', () => {
    const q = new ToastQueue(2, 3.2, 12);
    for (const t of ['a', 'b', 'c', 'd', 'e']) q.push({ label: 'x', text: t });
    expect(run(q, 20)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(q.visible).toHaveLength(0);
    expect(q.pending).toHaveLength(0);
  });

  it('同時に見えるのは 2 件まで。表示中に追加した通知は、空いた枠に順に出る', () => {
    const q = new ToastQueue(2, 3.2, 12);
    q.push({ label: 'x', text: 'a' });
    q.push({ label: 'x', text: 'b' });
    expect(run(q, 1)).toEqual(['a', 'b']);
    q.push({ label: 'x', text: 'c' });
    expect(q.visible).toHaveLength(2);
    expect(run(q, 1)).toEqual([]); // まだ枠が空かない
    expect(run(q, 3)).toEqual(['c']);
  });

  it('通知が隠れている間（画面を開いている間）は表示時間を進めず、見る前に消さない', () => {
    const q = new ToastQueue(2, 3.2, 12);
    for (const t of ['a', 'b', 'c']) q.push({ label: 'x', text: t });
    run(q, 1);
    run(q, 60, true); // 画面を開いて 60 秒
    expect(q.visible.map((v) => v.text)).toEqual(['a', 'b']);
    expect(q.pending.map((v) => v.text)).toEqual(['c']);
    expect(run(q, 10)).toEqual(['c']);
  });

  it('同じ通知は重ねて並べない。表示待ちは上限を超えたら古いものから捨てる（無制限にたまらない）', () => {
    const q = new ToastQueue(2, 3.2, 3);
    q.push({ label: 'x', text: 'a' });
    q.push({ label: 'x', text: 'a' });
    expect(q.pending).toHaveLength(1);
    for (const t of ['b', 'c', 'd', 'e']) q.push({ label: 'x', text: t });
    expect(q.pending.map((p) => p.text)).toEqual(['c', 'd', 'e']);
    expect(q.dropped).toBe(2);
  });

  it('会話中に溜めた通知（ふつうの送り・速い送り）も、会話の後に一度ずつすべて出る', () => {
    for (const fast of [false, true]) {
      const notices = new NoticeQueue<string>();
      const toasts = new ToastQueue<ToastItem>(2, 3.2, 12);
      notices.begin();
      notices.nodeChanged(false);
      for (const t of ['手帳1', '手帳2', '意向', '約束']) notices.push({ label: 'x', text: t });
      // ふつうの送り：場面ごとに出る／速い送り：会話の終わりにまとめて出る
      if (!fast) notices.nodeChanged(true).notices.forEach((n) => toasts.push(n));
      notices.end().notices.forEach((n) => toasts.push(n));
      expect(run(toasts, 20)).toEqual(['手帳1', '手帳2', '意向', '約束']);
    }
  });
});

// ───────── 3：結帳の過去の記録と第3幕 ─────────

describe('結帳の十五年前の記録と第3幕の選択肢・結末が矛盾しない（指摘 3）', () => {
  const l1 = LEDGER.find((e) => e.id === 'L1')!.items.find((i) => i.id === 'L1-isuke')!;
  const saeHelp = PLAN3_ITEMS.find((i) => i.id === 'saeHelp')!;
  const opt = (id: string) => saeHelp.options.find((o) => o.id === id)!;

  it('十五年前、伊助家がしたのは屋根の上の仕事（結帳）。「記録どおり」の選択肢はそれと同じ仕事', () => {
    expect(l1.detail).toContain('屋根の上');
    expect(l1.detail).not.toContain('下の仕事');
    expect(opt('roofTop').label).toContain('屋根の上');
    expect(opt('roofTop').detail).toContain('同じ仕事');
  });

  it('「下の仕事」の選択肢と E1 は、十五年前とは違う仕事として扱う（同じ仕事だとは言わない）', () => {
    expect(opt('ground').label).toContain('下の仕事');
    expect(`${opt('ground').label}${opt('ground').detail ?? ''}`).not.toContain('同じ');
    const e1 = [...ENDINGS.e1!.story, ...ENDINGS.e1!.remains].map((l) => l.text).join('\n');
    expect(e1).toMatch(/違う仕事|屋根の上の仕事ではなかった/);
  });

  it('E1 で結帳に書き加わる返しの記録も、屋根の上ではない（下の仕事）と記す', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    decide(s, PLANS['solo-full']!);
    toChapter3(s);
    decide(s, PLAN3.e1!);
    const l1now = ledgerEntries(s).find((e) => e.id === 'L1')!.items.find((i) => i.id === 'L1-isuke')!;
    expect(l1now.settlement).toBe('settled');
    expect(l1now.settlementNote).toContain('下の仕事');
    expect(l1now.detail).toContain('屋根の上'); // 十五年前の仕事の記録はそのまま
  });
});

// ───────── 4：E1 の新しい約束 ─────────

describe('E1 で成立した約束を、手帳・結帳・振り返りに記す（指摘 4）', () => {
  const partIds = OUTCOME_IDS.filter((id) => !parseOutcomeId(id)!.full);
  const fullIds = OUTCOME_IDS.filter((id) => parseOutcomeId(id)!.full);
  const promiseText = 'サエ家の屋根の残りを葺くときは、伊助家が手を貸す';

  const play = (act1: string, ending: string | null) => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    decide(s, PLANS[act1]!);
    toChapter3(s);
    if (ending) expect(decide(s, PLAN3[ending]!)).toBe(ending);
    return s;
  };

  it.each(partIds)('%s → E1：約束が手帳と結帳に一度だけ、まだ果たしていない約束として記される', (id) => {
    const s = play(id, 'e1');
    const nb = buildNotebook(s, SRC).promises.filter((p) => p.content === promiseText);
    expect(nb).toHaveLength(1);
    expect(nb[0]).toMatchObject({ from: '伊助家', to: 'サエ家', kept: false });
    expect(buildLedger(s, ledgerEntries(s), SRC).promises.filter((p) => p.content === promiseText)).toHaveLength(1);
    // 結末の文章と同じ条件
    expect(shownLines(s, ENDINGS.e1!.story).join()).toContain('伊助家が手を貸す');
  });

  it.each(fullIds)('%s → E1：南面をすべて葺いた場合は、その約束はない', (id) => {
    const s = play(id, 'e1');
    expect(buildNotebook(s, SRC).promises.some((p) => p.content === promiseText)).toBe(false);
  });

  it.each(['e2', 'e3'])('一部だけ葺いた → %s：成立していない約束は出さない', (ending) => {
    for (const id of partIds) {
      const s = play(id, ending);
      expect(buildNotebook(s, SRC).promises.some((p) => p.content === promiseText), id).toBe(false);
    }
  });

  it('結末の前（第3幕の途中）には先に出さない。保存された約束と同じ ID があれば重ねない', () => {
    const s = play('solo-part', null);
    expect(derivedPromises(s)).toHaveLength(0);
    decide(s, PLAN3.e1!);
    expect(derivedPromises(s).map((p) => p.id)).toEqual([PROMISE_ISUKE_HELPS_SAE_REST]);
    s.recordPromise(PROMISE_ISUKE_HELPS_SAE_REST, 'isuke', 'sae', promiseText);
    expect(buildNotebook(s, SRC).promises.filter((p) => p.content === promiseText)).toHaveLength(1);
  });
});

// ───────── 5：長時間止まった後の音楽 ─────────

describe('長く止まった後に音楽をまとめて鳴らさない（指摘 5）', () => {
  const pacing = { gap: [0.8, 1.4] as const, phrase: [3, 6] as const, rest: [7, 13] as const };
  const rand = () => 0.5;

  it.each([3, 300, 3600])('%s 秒止まった後の 1 回の更新で予約する音は上限以内で、すべて今以降', (lag) => {
    const clock: MusicClock = { nextNote: 10, phraseLeft: 3 };
    const now = 10 + lag;
    const times = scheduleMusic(clock, now, now + 0.15, pacing, rand);
    expect(times.length).toBeLessThanOrEqual(MUSIC_MAX_NOTES_PER_UPDATE);
    for (const t of times) expect(t).toBeGreaterThanOrEqual(now);
    // 過去の音は追いかけず、少し間を置いて今から再開する
    expect(clock.nextNote).toBeGreaterThan(now);
  });

  it('ふつうのフレームでは途切れずに続く（60 秒で句と休みが交互に来る）', () => {
    const clock: MusicClock = { nextNote: 0.5, phraseLeft: 0 };
    let notes = 0;
    let maxPerUpdate = 0;
    for (let t = 0; t < 60; t += 1 / 60) {
      const n = scheduleMusic(clock, t, t + 0.15, pacing, rand).length;
      notes += n;
      maxPerUpdate = Math.max(maxPerUpdate, n);
    }
    expect(notes).toBeGreaterThan(10);
    expect(maxPerUpdate).toBeLessThanOrEqual(1);
  });

  it('少しの遅れ（1 秒未満）では、追いつくために詰めて鳴らさない', () => {
    const clock: MusicClock = { nextNote: 10, phraseLeft: 5 };
    const times = scheduleMusic(clock, 10.6, 10.75, pacing, rand);
    expect(times.length).toBe(1);
  });
});

// ───────── 6：人物の GPU の資源 ─────────

describe('人物の資源の片付け（指摘 6）', () => {
  it('骨（Skeleton）と人物ごとの形を捨て、共有の形（足元の影）と材質は捨てない。二度呼んでも問題ない', () => {
    for (const look of [CHARACTERS.sae.appearance, VILLAGER_LOOKS[0]!]) {
      const rig = createPersonRig(look);
      const skel = vi.spyOn(rig.mesh.skeleton, 'dispose');
      const disposed: THREE.BufferGeometry[] = [];
      let shared: THREE.BufferGeometry | null = null;
      rig.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o.userData.shared) shared = o.geometry;
        o.geometry.addEventListener('dispose', () => disposed.push(o.geometry));
      });
      disposePersonRig(rig);
      expect(skel).toHaveBeenCalled();
      expect(disposed).toContain(rig.mesh.geometry);
      expect(shared).not.toBeNull();
      expect(disposed).not.toContain(shared);
      expect(() => disposePersonRig(rig)).not.toThrow();
    }
  });
});

// ───────── 7：第三者ライセンス ─────────

describe('公開物の第三者ライセンス（指摘 7）', () => {
  it('配布物に入る依存（three）のライセンス文の全文と著作権表示を集める', () => {
    const list = collectLicenses('.');
    const three = list.find((l) => l.name === 'three')!;
    expect(three.license).toBe('MIT');
    expect(three.text).toContain('three.js authors');
    expect(three.text).toContain('Permission is hereby granted');
    const text = licensesText('.');
    expect(text).toContain(`three ${three.version} (MIT)`);
    expect(text).toContain(three.text);
    // 開発用の依存は含めない
    expect(list.map((l) => l.name)).not.toContain('vite');
  });
});

// ───────── 8：作業前の結帳 ─────────

describe('屋根葺きの日を終えるまでは、結帳の今年の記録は予定として記す（指摘 8）', () => {
  it.each(OUTCOME_IDS)('%s：作業前・作業中は予定、終えた後と第3幕は実際の記録', (id) => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    expect(ledgerEntries(s).some((e) => e.id === 'L3')).toBe(false); // 決める前は記録がない
    decide(s, PLANS[id]!);
    const before = ledgerEntries(s).find((e) => e.id === 'L3')!;
    expect(before.when).toContain('予定');
    for (const i of before.items) expect(i.detail.startsWith('予定：')).toBe(true);
    endRoofDay(s);
    const after = ledgerEntries(s).find((e) => e.id === 'L3')!;
    expect(after.when).not.toContain('予定');
    for (const i of after.items) expect(i.detail.startsWith('予定')).toBe(false);
    toChapter3(s);
    const later = ledgerEntries(s).find((e) => e.id === 'L3')!;
    expect(later.when).not.toContain('予定');
    if (parseOutcomeId(id)!.full) expect(later.items.find((i) => i.id === 'L3-mine')!.settlement).toBe('settled');
  });
});
