import { describe, expect, it } from 'vitest';
import { penetration } from '../src/core/collision';
import { CHARACTERS } from '../src/content/characters';
import { DIALOGUES } from '../src/content/dialogues';
import { INTERACTABLES, NPCS, NPC_COLLIDER_RADIUS, npcColliders } from '../src/content/interactables';
import { PROMISES_KEPT_BY_CH3, ledgerEntries } from '../src/content/chronicle';
import {
  INITIAL_PLAN,
  ON_SITE,
  OUTCOMES,
  OUTCOME_IDS,
  PLAN_ROOF,
  RELEVANT_TOPICS,
  RESPONSE_SUMMARY,
  forecastPlan,
} from '../src/content/plan';
import { roofDayColliders, roofDayStage, staticCrew } from '../src/content/staging';
import { ENDINGS, INITIAL_PLAN3, RELEVANT_TOPICS3, RESPONSE_SUMMARY3, forecastPlan3 } from '../src/content/plan3';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { currentObjective } from '../src/content/objectives';
import { parseEmphasis, plainText } from '../src/dialogue/markup';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { buildNotebook } from '../src/journal/models';
import { buildOutcome, buildPlanBoard, type PlanSources } from '../src/journal/planModels';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { createSave, parseSave } from '../src/save/saveData';
import { StoryState } from '../src/story/StoryState';
import type { PlanSpec } from '../src/story/types';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, PATHS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, distanceToSegment } from '../src/world/layout';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 4（docs/PHASE4_DESIGN.md）：宗平・ミネを含む第1幕の計画、屋根葺き当日、第3幕、エンディング。
 */

const src: PlanSources = {
  characters: CHARACTERS,
  households: HOUSEHOLDS,
  planSummaries: { ...RESPONSE_SUMMARY, ...RESPONSE_SUMMARY3 },
  plans: {
    roof: {
      summaries: RESPONSE_SUMMARY,
      forecast: forecastPlan,
      relevantTopics: RELEVANT_TOPICS,
      outcomeTitle: (id) => OUTCOMES[id]?.title,
      outcomeTagline: (id) => OUTCOMES[id]?.tagline,
    },
    isukeRoof: {
      summaries: RESPONSE_SUMMARY3,
      forecast: forecastPlan3,
      relevantTopics: RELEVANT_TOPICS3,
      outcomeTitle: (id) => ENDINGS[id]?.title,
      outcomeTagline: (id) => ENDINGS[id]?.title,
    },
  },
};

// ───────── 補助 ─────────

function newGame() {
  const story = new StoryState(STORY_DEFS);
  return { story, sys: new InteractionSystem(INTERACTABLES, DIALOGUES, story) };
}

type Picker = (choices: readonly string[]) => number;

function talk(sys: InteractionSystem, id: string, pick: Picker = (c) => c.length - 1): string[] {
  const def = sys.interactables.find((i) => i.id === id)!;
  sys.setIndoor(def.indoor ?? false);
  sys.updateTarget({ x: def.position.x, z: def.position.z - 1, heading: 0 });
  expect(sys.target?.id).toBe(id);
  sys.interact();
  const seen: string[] = [];
  for (let guard = 0; sys.isActive; guard++) {
    if (guard > 100) throw new Error(`${id} の会話が終わらない`);
    const view = sys.view!;
    seen.push(plainText(view.text));
    if (view.choices.length > 0) sys.choose(pick(view.choices.map((c) => c.text)));
    else sys.advance();
  }
  return seen;
}

/** 指定した文言の選択肢を順に選び、尽きたら最後（会話を切り上げる選択肢）を選ぶ。 */
const say = (...texts: string[]): Picker => {
  let i = 0;
  return (c) => {
    const want = texts[i];
    if (want === undefined) return c.length - 1;
    const idx = c.findIndex((x) => x.includes(want));
    if (idx < 0) throw new Error(`選択肢「${want}」がない：${c.join(' / ')}`);
    i++;
    return idx;
  };
};

/** 作業台の今の案を、関係する全員に相談する（会話を通して）。 */
function consultAll(sys: InteractionSystem, story: StoryState) {
  for (const npc of story.planInvolved()) talk(sys, npc, say('作業台でまとめた案', 'この'));
}

/** すべての情報を知っている状態（第1幕の判断に関わるもの）。 */
function knowingAll(story: StoryState) {
  const learn: Array<[string, string]> = [
    ['sae.schedule', 'needsHelp'],
    ['sae.dateReason', 'burden'],
    ['sae.roof', 'worn'],
    ['sae.kaya', 'short'],
    ['isuke.field', 'progress'],
    ['isuke.availability', 'dayBefore'],
    ['isuke.pastHelp', 'isukeView'],
    ['sohei.schedule', 'kayaCutting'],
    ['mine.kaya', 'whyRecord'],
    ['mine.cutting', 'canLead'],
    ['ledger.basics', 'read'],
  ];
  for (const [t, st] of learn) story.learn(t, st);
}

/** 規則どおりに全員へ相談し、決める（会話を通さない、状態だけの確認用）。 */
function consultAndDecide(story: StoryState, plan: PlanSpec): string | null {
  story.setPlanDraft(plan);
  for (const npc of story.planInvolved()) story.consultPlan(npc);
  return story.decidePlan();
}

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

/** Game と同じ章の進め方：屋根葺きの日を終える → 三年後。 */
function toChapter3(story: StoryState) {
  story.set('roofDay:ended');
  for (const id of PROMISES_KEPT_BY_CH3) if (story.allPromises().some((p) => p.id === id)) story.set(`kept:${id}`);
  story.setChapter('ch3');
}

const optionIds = (story: StoryState, item: string) => buildPlanBoard(story, src).items.find((i) => i.id === item)?.options.map((o) => o.id);

// ───────── 宗平・ミネの事情を知ることで選択肢が変わる ─────────

describe('宗平・ミネの事情と、作業台の選択肢', () => {
  it('会話で宗平の別件（茅刈り）を知ると、「ミネに茅刈りを頼む」が選べるようになる', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    talk(sys, 'isuke');
    talk(sys, 'hasaRack');
    talk(sys, 'isuke', say('はさ掛け'));
    story.setPlanDraft({ ...INITIAL_PLAN, date: 'afterHarvest' });
    expect(optionIds(story, 'soheiCover')).toEqual(['none']);

    talk(sys, 'sohei', say('当日来られますか'));
    expect(story.currentStage('sohei.schedule')).toBe('hasConflict');
    const lines = talk(sys, 'sohei', say('動けない日というのは'));
    expect(lines.join()).toContain('茅場で茅刈りがある');
    expect(story.currentStage('sohei.schedule')).toBe('kayaCutting');
    expect(optionIds(story, 'soheiCover')).toEqual(['none', 'mineCovers']);

    // ミネに聞くと、茅刈りを仕切れば茅も貸せる余裕が出ることが分かる
    talk(sys, 'mine', say('宗平さんの茅刈り'));
    expect(story.currentStage('mine.cutting')).toBe('canLead');
  });

  it('ミネの条件（茅で返す・記す）は、相談の返事と控えから分かり、返し方の選択肢が増える', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    story.setPlanDraft(INITIAL_PLAN);
    expect(optionIds(story, 'kayaReturn')).toEqual(['labor']);
    // 「手伝いで返す」で相談 → 条件付き（要るのは茅）→ 茅で返す が選べる
    consultAll(sys, story);
    expect(story.planResponse('mine')).toMatchObject({ status: 'conditional', reason: 'wantsKaya' });
    expect(optionIds(story, 'kayaReturn')).toEqual(['labor', 'nextYear']);
    // 口約束 → 条件付き（書き残してほしい）、控えを見る許可
    story.setPlanDraft({ ...story.planDraft()!, kayaReturn: 'nextYear' });
    talk(sys, 'mine', say('作業台でまとめた案', 'この'));
    expect(story.planResponse('mine')?.reason).toBe('wantsRecord');
    expect(story.consentStatus('mine', 'showRecords')).toBe('agreed');
    // 控えを読む → 記して返す が選べる
    talk(sys, 'mineRecords');
    expect(optionIds(story, 'kayaReturn')).toEqual(['labor', 'nextYear', 'nextYearRecorded']);
  });

  it('サエ家の茅が足りないと知ると「手持ちだけで葺く」が選べ、返し方の項目は消える', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    story.setPlanDraft(INITIAL_PLAN);
    expect(optionIds(story, 'kaya')).toEqual(['mine']);
    talk(sys, 'sae', say('茅は足りていますか'));
    expect(optionIds(story, 'kaya')).toEqual(['mine', 'own']);
    story.setPlanDraft({ ...story.planDraft()!, kaya: 'own' });
    expect(story.planDraft()!.kayaReturn).toBe('none');
    const items = buildPlanBoard(story, src).items.map((i) => i.id);
    expect(items).not.toContain('kayaReturn');
    expect(items).not.toContain('soheiCover');
    // 表示しない選択肢（借りない）は、茅を借りるときに出てこない
    story.setPlanDraft({ ...story.planDraft()!, kaya: 'mine' });
    expect(optionIds(story, 'kayaReturn')).not.toContain('none');
  });
});

// ───────── 返事の規則 ─────────

describe('返事の規則（今の事情と提案内容だけで決まる）', () => {
  const r = (npc: string, plan: Record<string, string>) => PLAN_ROOF.respond(npc, { ...INITIAL_PLAN, ...plan });

  it('宗平：延ばすなら、ミネが茅刈りを代わらないと来られない', () => {
    expect(r('sohei', { date: 'afterHarvest', isuke: 'dayOf' })).toEqual({ status: 'declined', reason: 'kayaCuttingDay' });
    expect(r('sohei', { date: 'afterHarvest', isuke: 'dayOf', soheiCover: 'mineCovers' }).status).toBe('agreed');
    expect(r('sohei', { kaya: 'own', kayaReturn: 'none' }).reason).toBe('partialOnly');
  });

  it('ミネ：手伝いでの返し・口約束は条件付き、延ばして茅だけ借りるのは断る、茅刈りを仕切るなら貸せる', () => {
    expect(r('mine', { kayaReturn: 'labor' }).status).toBe('conditional');
    expect(r('mine', { kayaReturn: 'nextYear' }).status).toBe('conditional');
    expect(r('mine', { kayaReturn: 'nextYearRecorded' }).status).toBe('agreed');
    expect(r('mine', { date: 'afterHarvest', isuke: 'dayOf', kayaReturn: 'nextYearRecorded' })).toEqual({ status: 'declined', reason: 'moreKaya' });
    expect(r('mine', { date: 'afterHarvest', isuke: 'dayOf', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' }).reason).toBe('coverAndLend');
  });

  it('過去の記録・会話の回数・情報の有無では返事が変わらない', () => {
    const plan = { ...INITIAL_PLAN, kayaReturn: 'nextYear' };
    const a = new StoryState(STORY_DEFS);
    const b = new StoryState(STORY_DEFS);
    knowingAll(b);
    b.setConsent('mine', 'lendKaya', 'agreed');
    for (const s of [a, b]) {
      s.setPlanDraft(plan);
      s.consultPlan('mine');
    }
    expect(a.planResponse('mine')).toEqual({ ...b.planResponse('mine'), order: a.planResponse('mine')!.order });
  });

  it('承諾していない住民がいる案は決められない。案を変えると古い承諾は使えない', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    s.setPlanDraft(PLANS['solo-full']!);
    for (const npc of ['sae', 'sohei']) s.consultPlan(npc);
    expect(s.planPhase()).toBe('pending'); // ミネに未相談
    expect(s.decidePlan()).toBeNull();
    s.consultPlan('mine');
    expect(s.planPhase()).toBe('ready');
    // 返し方だけ変える → 前の案への承諾は使えない（全員に相談し直し）
    s.setPlanDraft({ ...PLANS['solo-full']!, kayaReturn: 'nextYear' });
    expect(s.planPhase()).toBe('pending');
    expect(s.planResponse('sae')).toBeUndefined();
    expect(s.decidePlan()).toBeNull();
    // 元の案に戻せば、その案への承諾は有効
    s.setPlanDraft(PLANS['solo-full']!);
    expect(s.decidePlan()).toBe('solo-full');
  });

  it('成立する組み合わせは 8 通りで、どれも関係者全員が承諾する。どれも必ず代償がある', () => {
    const s = new StoryState(STORY_DEFS);
    for (const [id, plan] of Object.entries(PLANS)) {
      expect(PLAN_ROOF.outcome(plan), id).toBe(id);
      for (const npc of PLAN_ROOF.involved(plan)) expect(PLAN_ROOF.respond(npc, plan).status, `${id}/${npc}`).toBe('agreed');
      const def = OUTCOMES[id]!;
      expect(def.achieved.length, id).toBeGreaterThan(0);
      expect(def.costs.filter((c) => !c.when).length, id).toBeGreaterThan(0);
    }
    expect(OUTCOME_IDS).toEqual(Object.keys(PLANS).sort((a, b) => OUTCOME_IDS.indexOf(a) - OUTCOME_IDS.indexOf(b)));
    // 全組み合わせを総当たり：結果がある案 ⇔ 全員承諾
    let decidable = 0;
    const items = PLAN_ROOF.items;
    const walk = (i: number, plan: Record<string, string>) => {
      if (i === items.length) {
        const p = PLAN_ROOF.normalize!(plan);
        if (JSON.stringify(p) !== JSON.stringify(plan) || PLAN_ROOF.invalidReason(p) !== null) return;
        const all = PLAN_ROOF.involved(p).every((n) => PLAN_ROOF.respond(n, p).status === 'agreed');
        expect(PLAN_ROOF.outcome(p) !== null, JSON.stringify(p)).toBe(all);
        if (all) decidable++;
        return;
      }
      for (const o of items[i]!.options) walk(i + 1, { ...plan, [items[i]!.id]: o.id });
    };
    walk(0, {});
    expect(decidable).toBe(8);
    void s;
  });

  it('情報がなくても「予定日・頼まない・手持ちの茅」…ではなく、最初から選べる案だけで進行不能にならない', () => {
    // 何も知らない状態で選べる選択肢だけの組み合わせのうち、全員が承諾する案があるか
    // （手持ちの茅は情報が要るので、知らないと選べない → ミネの条件を聞く必要がある）
    const s = new StoryState(STORY_DEFS);
    s.learn('sae.schedule', 'needsHelp');
    s.setPlanDraft(INITIAL_PLAN);
    const board = buildPlanBoard(s, src);
    expect(board.items.find((i) => i.id === 'kaya')!.hidden).toBe(1);
    // 相談すればミネの返事で「茅で返す」が分かり、さらに控えで「記す」が分かる → 進める道がある（上のテスト）
    expect(PLAN_ROOF.respond('mine', INITIAL_PLAN).status).toBe('conditional');
  });
});

// ───────── 結果 ─────────

describe('第1幕の結果', () => {
  it.each(Object.keys(PLANS))('「%s」に到達し、状態・結帳・約束がそれぞれ違う', (id) => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    expect(consultAndDecide(s, PLANS[id]!)).toBe(id);
    expect(s.chapter).toBe('roofDay');
    const full = id.endsWith('-full');
    expect(s.currentStage('sae.roof')).toBe(full ? 'renewed' : 'partial');
    expect(s.allPromises().some((p) => p.id === 'saeReturnsKaya')).toBe(full);
    expect(s.allPromises().some((p) => p.id === 'saeHelpsIsukeHarvest')).toBe(id.startsWith('prep'));
    expect(s.consentStatus('mine', 'coverSohei') === 'agreed').toBe(id.startsWith('wait'));
    const ledger = ledgerEntries(s).find((e) => e.id === 'L3')!;
    expect(ledger.items.some((i) => i.id === 'L3-mine')).toBe(full);
    const view = buildOutcome(s, OUTCOMES, src, 'roof')!;
    expect(view.achieved.length).toBeGreaterThan(0);
    expect(view.costs.length).toBeGreaterThan(0);
  });

  it('8 つの結果の見込みは、すべて異なる', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    const texts = Object.values(PLANS).map((p) => forecastPlan(p, s).map((l) => `${l.aspect}:${l.text}`).join('\n'));
    expect(new Set(texts).size).toBe(8);
  });

  it('見込みは知っている情報の分だけ見通せる（宗平の別件・ミネの茅の当て）', () => {
    const little = new StoryState(STORY_DEFS);
    little.learn('isuke.availability', 'harvest');
    const unsure = forecastPlan({ ...INITIAL_PLAN, date: 'afterHarvest' }, little).find((l) => l.aspect === '段取りと茅')!;
    expect(unsure.uncertain).toBe(true);
    expect(unsure.text).toContain('来られるかは分からない');
    const all = new StoryState(STORY_DEFS);
    knowingAll(all);
    const sure = forecastPlan({ ...INITIAL_PLAN, date: 'afterHarvest' }, all).find((l) => l.aspect === '段取りと茅')!;
    expect(sure.text).toContain('茅場の茅刈りを仕切っていて来られない');
    const cover = forecastPlan(PLANS['wait-full']!, all).find((l) => l.aspect === '段取りと茅')!;
    expect(cover.text).toContain('新しい茅の当て');
  });
});

// ───────── 章の流れ・第3幕・エンディング ─────────

describe('屋根葺き当日 → 第3幕 → エンディング', () => {
  function toCh3(id: string) {
    const { story, sys } = newGame();
    knowingAll(story);
    consultAndDecide(story, PLANS[id]!);
    return { story, sys };
  }

  it('屋根葺き当日：サエと話して一日を終えられ、住民の台詞が計画で変わる', () => {
    const { story, sys } = toCh3('wait-full');
    expect(currentObjective(story)).toContain('屋根葺きの日');
    expect(talk(sys, 'sohei').join()).toContain('ミネが茅刈りを仕切ってくれた');
    expect(talk(sys, 'mine').join()).toContain('茅場');
    talk(sys, 'sae', say('一日を終える'));
    expect(story.has('roofDay:ended')).toBe(true);
  });

  it('第3幕：記録どおり「屋根の上」を頼んでもサエは断り（強制できない）、足のことを知って役割を相談し直すと E1', () => {
    const { story, sys } = toCh3('prep-full');
    toChapter3(story);
    expect(story.has('kept:saeHelpsIsukeHarvest')).toBe(true);
    expect(story.has('kept:saeReturnsKaya')).toBe(true);
    expect(currentObjective(story)).toContain('伊助');
    const isuke = talk(sys, 'isuke');
    expect(isuke.join()).toContain('刈り入れを手伝ってもらった'); // 第1幕の結果が台詞に表れる
    expect(story.currentStage('isuke.roof3')).toBe('needsRoof');

    // Q2：記録どおり → サエは断る（足のこと）。下の仕事の選択肢はまだ出ない
    story.setPlanDraft(INITIAL_PLAN3);
    expect(optionIds(story, 'saeHelp')).toEqual(['roofTop', 'none']);
    consultAll(sys, story);
    expect(story.planResponse('sae')).toMatchObject({ status: 'declined', reason: 'injured' });
    expect(story.planResponse('isuke')?.status).toBe('agreed');
    expect(story.planPhase()).toBe('revise');
    expect(story.decidePlan()).toBeNull();
    // 断られて足のことが分かる → Q1 が選べる
    expect(story.currentStage('sae.later')).toBe('injured');
    expect(optionIds(story, 'saeHelp')).toEqual(['roofTop', 'ground', 'none']);
    story.setPlanDraft({ timing: 'now', saeHelp: 'ground' });
    consultAll(sys, story);
    expect(story.decidePlan()).toBe('e1');
    expect(story.chapter).toBe('end');
    // 結帳：十五年前の記録の返しが済み、今年の記録が加わる
    const entries = ledgerEntries(story);
    expect(entries.find((e) => e.id === 'L1')!.items.find((i) => i.id === 'L1-isuke')!.settlement).toBe('settled');
    expect(entries.find((e) => e.id === 'L4')!.items.some((i) => i.id === 'L4-sae')).toBe(true);
    expect(entries.find((e) => e.id === 'L3')!.items.find((i) => i.id === 'L3-mine')!.settlement).toBe('settled');
    expect(talk(sys, 'isuke').join()).toContain('これで十分だ');
  });

  it('第3幕：サエ家に頼まず葺くと E2（返しは残る）、見送ると E3', () => {
    for (const [plan, ending] of [
      [{ timing: 'now', saeHelp: 'none' }, 'e2'],
      [{ timing: 'nextYear', saeHelp: 'none' }, 'e3'],
    ] as const) {
      const { story } = toCh3('solo-part');
      toChapter3(story);
      story.learn('isuke.roof3', 'needsRoof');
      expect(consultAndDecide(story, plan)).toBe(ending);
      const l1 = ledgerEntries(story).find((e) => e.id === 'L1')!.items.find((i) => i.id === 'L1-isuke')!;
      expect(l1.settlement).toBe('open');
      expect(ledgerEntries(story).some((e) => e.id === 'L4')).toBe(ending === 'e2');
    }
  });

  it('第1幕で茅を借りなかった場合、第3幕に「約束を果たした」ことにはならない', () => {
    const { story } = toCh3('solo-part');
    toChapter3(story);
    expect(story.flagList().some((f) => f.startsWith('kept:'))).toBe(false);
    expect(buildNotebook(story, src).promises).toEqual([]);
  });

  it('過去の記録・第1幕の結果に関係なく、第3幕の返事は同じ（記録を理由に強制できない）', () => {
    for (const id of Object.keys(PLANS)) {
      const { story } = toCh3(id);
      toChapter3(story);
      story.setPlanDraft(INITIAL_PLAN3);
      story.consultPlan('sae');
      expect(story.planResponse('sae')?.status, id).toBe('declined');
    }
  });
});

// ───────── 保存と移行 ─────────

describe('保存（版3）と移行', () => {
  const save = (s: StoryState) => JSON.parse(JSON.stringify(createSave(s.snapshot(), { x: 0, z: 31, heading: 0 })));

  it('各章で保存・読込すると、章・両方の計画・約束が戻る', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    const states: unknown[] = [];
    consultAndDecide(s, PLANS['wait-full']!);
    states.push(save(s));
    toChapter3(s);
    s.learn('isuke.roof3', 'needsRoof');
    s.setPlanDraft(INITIAL_PLAN3);
    s.consultPlan('sae');
    states.push(save(s));
    s.learn('sae.later', 'injured');
    consultAndDecide(s, { timing: 'now', saeHelp: 'ground' });
    states.push(save(s));
    for (const d of states) {
      const parsed = parseSave(JSON.stringify(d), STORY_DEFS);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.warnings).toEqual([]);
      const r = new StoryState(STORY_DEFS);
      r.restore(parsed.save.story);
      expect(r.snapshot()).toEqual((d as { story: unknown }).story);
    }
  });

  it('版2（Phase 3 の計画を決めた記録）は、探索の記録を残して第1幕の計画前に戻す', () => {
    const v2 = {
      format: 'yui-no-yakusoku-save',
      version: 2,
      savedAt: '2026-10-14T00:00:00.000Z',
      player: { x: 0, z: 31, heading: 0 },
      story: {
        clock: 20,
        flags: ['talked:sae', 'roofing:done'],
        learned: [
          { topic: 'sae.schedule', stage: 'needsHelp', order: 1 },
          { topic: 'sae.roof', stage: 'renewed', order: 19 },
        ],
        npcs: [{ id: 'isuke', met: true, consents: [{ request: 'roofPrep', status: 'agreed', order: 18 }] }],
        promises: [{ id: 'saeHelpsIsukeHarvest', from: 'sae', to: 'isuke', content: 'x', order: 17 }],
        plan: {
          draft: { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp' },
          responses: [],
          decision: { plan: { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp' }, outcome: 'r2', order: 16 },
        },
      },
    };
    const parsed = parseSave(JSON.stringify(v2), STORY_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings.join()).toContain('立て直す必要');
    const st = parsed.save.story;
    expect(st.chapter).toBe('ch1');
    expect(st.plans).toEqual({});
    expect(st.flags).toEqual(['talked:sae']);
    expect(st.learned.map((l) => l.topic)).toEqual(['sae.schedule']);
    expect(st.promises).toEqual([]);
    expect(st.npcs[0]!.consents).toEqual([]);
  });

  it('章と決定が食い違う記録は破損として扱う', () => {
    const s = new StoryState(STORY_DEFS);
    const d = save(s);
    d.story.chapter = 'ch3';
    expect(parseSave(JSON.stringify(d), STORY_DEFS)).toMatchObject({ ok: false, reason: 'corrupt' });
    d.story.chapter = 'nowhere';
    expect(parseSave(JSON.stringify(d), STORY_DEFS)).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  it('依存関係の整っていない案（茅を借りないのに返し方がある等）は読み飛ばす', () => {
    const s = new StoryState(STORY_DEFS);
    s.setPlanDraft(INITIAL_PLAN);
    const d = save(s);
    d.story.plans.roof.draft = { ...INITIAL_PLAN, kaya: 'own', kayaReturn: 'labor' };
    const parsed = parseSave(JSON.stringify(d), STORY_DEFS);
    expect(parsed.ok && parsed.save.story.plans.roof?.draft).toBeNull();
  });
});

// ───────── 配置・情報の整理（Phase 3.5 から引き継ぐ確認） ─────────

describe('屋根葺き当日の立ち位置と、情報の整理', () => {
  const world = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });

  // Phase 5：名前のない村の人たち・茅の山・梯子は、計画ごとの当日の様子（content/staging.ts）から置く
  it.each(Object.keys(PLANS))('「%s」の当日、住民と村の人たち・茅の山・梯子は障害物・道と重ならず、話しかけに行ける', (id) => {
    const o = OUTCOMES[id]!;
    const stage = roofDayStage(id)!;
    const npcs = NPCS.map((n) => {
      const p = o.placements[n.character];
      return p ? { ...n, position: p.position, heading: p.heading } : n;
    });
    const stageColliders = roofDayColliders(stage);
    const crew = staticCrew(stage);
    const people = [...npcs.map((n) => n.position), ...crew.map((c) => c.position)];
    for (const p of people) {
      for (const c of world) expect(penetration(p, NPC_COLLIDER_RADIUS, c)).toBeNull();
      // 人は茅の山・梯子と重ならない（自分自身の判定は除く）
      for (const c of stageColliders) {
        if (c.kind === 'circle' && c.x === p.x && c.z === p.z) continue;
        expect(penetration(p, NPC_COLLIDER_RADIUS, c)).toBeNull();
      }
      for (const q of people) if (q !== p) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan(1.2);
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          expect(distanceToSegment(p.x, p.z, path.points[i]!, path.points[i + 1]!)).toBeGreaterThan(path.width / 2 + NPC_COLLIDER_RADIUS + 0.2);
        }
      }
    }
    // 茅の山・梯子も道の上に置かない（道の中心線に沿って、道幅の円が重ならないか調べる）
    for (const path of PATHS) {
      for (let i = 0; i + 1 < path.points.length; i++) {
        const a = path.points[i]!;
        const b = path.points[i + 1]!;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
        for (let k = 0; k <= n; k++) {
          const pt = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
          for (const c of stageColliders) expect(penetration(pt, path.width / 2, c), `${c.x},${c.z}`).toBeNull();
        }
      }
    }
    const map = buildReachability([...world, ...npcColliders(npcs), ...stageColliders], WALK_BOUNDS, PLAYER_START.position, DEFAULT_PLAYER_TUNING.radius);
    for (const n of npcs) expect(map.nearestReachable(n.position), n.id).toBeLessThan(n.range - 0.4);
    // 作業台・サエ家の屋根（当日は「作業中」）・サエ家の入口にも行ける（結帳は室内：tests/phase5_5.test.ts）
    for (const id2 of ['planTable', 'saeRoof', 'saeDoor']) {
      const def = INTERACTABLES.find((i) => i.id === id2)!;
      expect(map.nearestReachable(def.position)).toBeLessThan(def.range - 0.4);
    }
    expect(Object.keys(ON_SITE)).toEqual(['sohei', 'isuke', 'mine']);
  });

  it('すべての情報の段階に、要点と全文がある', () => {
    for (const t of Object.values(STORY_DEFS.topics)) {
      for (const st of t.stages) {
        expect(st.summary, `${t.id}/${st.id}`).toBeTruthy();
        expect(st.text.length, `${t.id}/${st.id}`).toBeGreaterThan(st.summary!.length);
      }
    }
  });

  it('会話の強調記法：要点だけを強調し、すべての台詞で ** が対になっている', () => {
    expect(parseEmphasis('前の**要点**後')).toEqual([
      { text: '前の', strong: false },
      { text: '要点', strong: true },
      { text: '後', strong: false },
    ]);
    for (const script of Object.values(DIALOGUES)) {
      for (const node of Object.values(script.nodes)) {
        for (const line of node.lines) expect(line.split('**').length % 2, `${script.id}: ${line}`).toBe(1);
      }
    }
  });

  it('作業台の「この案に関わる事情」は、今の案に関係する情報だけ。関係情報の定義は実在する', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    s.setPlanDraft(PLANS['solo-part']!);
    const titles = buildPlanBoard(s, src).considerations.map((c) => c.title);
    expect(titles.some((t) => t.includes('サエ家の茅'))).toBe(true);
    expect(titles.some((t) => t.includes('ミネ家の茅'))).toBe(false);
    for (const table of [RELEVANT_TOPICS, RELEVANT_TOPICS3]) {
      for (const byOption of Object.values(table)) for (const ts of Object.values(byOption)) for (const t of ts) expect(STORY_DEFS.topics[t], t).toBeDefined();
    }
  });
});
