import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS } from '../src/content/characters';
import { EXPLAIN, PROMISES_KEPT_BY_CH3 } from '../src/content/chronicle';
import { OUTCOMES, OUTCOME_IDS, RELEVANT_TOPICS, glancePlan, parseOutcomeId } from '../src/content/plan';
import { ENDINGS, RELEVANT_TOPICS3, glancePlan3 } from '../src/content/plan3';
import { roofDayArrival, roofDayBarks, roofDayProgress, roofDayWork } from '../src/content/staging';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { buildHistory, type HistorySources } from '../src/journal/historyModel';
import { buildOutcome, shownLines, unlockedOptions } from '../src/journal/planModels';
import { createSave, parseSave } from '../src/save/saveData';
import { StoryState } from '../src/story/StoryState';
import type { PlanSpec } from '../src/story/types';
import {
  DEFAULT_SETTINGS,
  LOOK_SENSITIVITY_RANGE,
  SettingsStore,
  effectiveVolumes,
  parseSettings,
} from '../src/settings/settings';
import { HINTS, selectHint } from '../src/game/hints';
import { allowsExploration, nextMode, RETURN_ACTION, type UiAction, type UiMode } from '../src/game/modes';
import { ambientMix, duckFactor, footstepSurface, musicMood, workSound } from '../src/audio/mix';
import { OUTDOOR_FRAMING, orbitSettingsFor, pickClearYaw, DEFAULT_ORBIT_SETTINGS } from '../src/camera/orbit';
import { createThatchRoof, type ThatchRoofSpec } from '../src/world/builders/thatch';
import { BRIDGE, WATERWAY } from '../src/world/layout';

/**
 * Phase 6（docs/PHASE6_PLAN.md）：設定・操作の手引き・画面の状態・音の出し分け・作業台の要点・
 * 決定と屋根葺きの日の時間の順序・屋根葺きの日の演出・選んだことの記録・エンディングの振り返り・史実と創作。
 */

// ───────── 補助 ─────────

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

/** Game と同じ：サエと話して一日を終える（dayEnd の効果）→ 三年後。 */
function endRoofDay(story: StoryState) {
  const outcome = story.planDecision('roof')!.outcome;
  story.learn('sae.roof', outcome.endsWith('-full') ? 'renewed' : 'partial');
  story.set('roofDay:ended');
}
function toChapter3(story: StoryState) {
  endRoofDay(story);
  for (const id of PROMISES_KEPT_BY_CH3) if (story.allPromises().some((p) => p.id === id)) story.set(`kept:${id}`);
  story.setChapter('ch3');
}

const JOURNAL = { characters: CHARACTERS, households: HOUSEHOLDS };
const HISTORY: HistorySources = {
  ...JOURNAL,
  actLabel: { roof: '第1幕', isukeRoof: '第3幕' },
  relevantTopics: { roof: RELEVANT_TOPICS, isukeRoof: RELEVANT_TOPICS3 },
  tagline: (planId, id) => (planId === 'roof' ? OUTCOMES[id]?.tagline : ENDINGS[id]?.title),
  result: (planId, id, story) => {
    if (planId === 'roof') {
      if (story.chapter === 'roofDay' && !story.has('roofDay:ended')) return null;
      const o = buildOutcome(story, OUTCOMES, JOURNAL, 'roof');
      return o ? { title: o.title, achieved: o.achieved, remains: o.costs } : null;
    }
    const e = ENDINGS[id]!;
    return { title: e.title, achieved: shownLines(story, e.achieved), remains: shownLines(story, e.remains) };
  },
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

// ───────── 設定 ─────────

describe('設定（保存・検証）', () => {
  it('保存がなければ既定値。壊れた値・範囲外の値は既定値・範囲内に直す', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{壊れた')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings(JSON.stringify({ lookSensitivity: 99, masterVolume: -1, musicVolume: 'x', textSpeed: 'warp', muted: 1, hintsDone: ['move', 3, 'move'] }));
    expect(s.lookSensitivity).toBe(LOOK_SENSITIVITY_RANGE.max);
    expect(s.masterVolume).toBe(0);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.textSpeed).toBe('normal');
    expect(s.muted).toBe(false);
    expect(s.hintsDone).toEqual(['move']);
  });

  it('変えた設定は保存され、作り直しても（再起動後も）読み込まれる。保存領域がなくてもその回は反映される', () => {
    const storage = memoryStorage();
    const a = new SettingsStore(storage);
    expect(a.update({ masterVolume: 0.3, lookSensitivity: 1.5, muted: true, textSpeed: 'fast' })).toBe(true);
    const b = new SettingsStore(storage);
    expect(b.value).toMatchObject({ masterVolume: 0.3, lookSensitivity: 1.5, muted: true, textSpeed: 'fast' });
    const none = new SettingsStore(null);
    expect(none.update({ muted: true })).toBe(false);
    expect(none.value.muted).toBe(true);
  });

  it('ミュートなら全部 0。音量は全体×種類', () => {
    expect(effectiveVolumes({ ...DEFAULT_SETTINGS, muted: true })).toEqual({ music: 0, ambient: 0, sfx: 0 });
    const v = effectiveVolumes({ ...DEFAULT_SETTINGS, masterVolume: 0.5, sfxVolume: 0.8 });
    expect(v.sfx).toBeCloseTo(0.4);
  });

  it('視点の感度は倍率で反映される', () => {
    expect(orbitSettingsFor(2).lookSensitivity).toBeCloseTo(DEFAULT_ORBIT_SETTINGS.lookSensitivity * 2);
  });
});

// ───────── 操作の手引き ─────────

describe('操作の手引き（初めて遊ぶ人向け）', () => {
  const ctx = (done: string[], o: Partial<Parameters<typeof selectHint>[0]> = {}) =>
    selectHint({ done: new Set(done), exploring: true, hasTarget: false, hasNotebookEntry: false, exploreTime: 0, ...o });

  it('歩く → 見回す → （記録があれば）手帳 の順に、まだ行っていない操作だけを出す', () => {
    expect(ctx([])?.id).toBe('move');
    expect(ctx(['move'])?.id).toBe('look');
    expect(ctx(['move', 'look'])).toBeNull();
    expect(ctx(['move', 'look'], { hasNotebookEntry: true })?.id).toBe('notebook');
    expect(ctx(['move', 'look', 'notebook'], { exploreTime: 30 })?.id).toBe('run');
    expect(ctx(['move', 'look', 'notebook', 'run'], { exploreTime: 90 })?.id).toBe('pause');
    expect(ctx(Object.keys(HINTS), { hasTarget: true, hasNotebookEntry: true, exploreTime: 999 })).toBeNull();
  });

  it('話せる相手が目の前にいるときは「E で話す」を先に出す。会話・画面の間は出さない', () => {
    expect(ctx([], { hasTarget: true })?.id).toBe('talk');
    expect(ctx([], { exploring: false, hasTarget: true })).toBeNull();
  });

  it('手引きは操作だけで、物語の情報を含まない（人物名を出さない）', () => {
    const names = Object.values(CHARACTERS).map((c) => c.name);
    for (const h of Object.values(HINTS)) for (const n of names) expect(h.text).not.toContain(n);
  });
});

// ───────── 画面の状態 ─────────

const ALL_MODES: UiMode[] = [
  'title', 'explore', 'dialogue', 'notebook', 'ledger', 'plan', 'result', 'ending', 'explain', 'settings', 'history', 'pause', 'notice', 'transition', 'cinematic',
];
const ALL_ACTIONS: UiAction[] = [
  'esc', 'tab', 'dialogueStarted', 'dialogueEnded', 'openTitle', 'openPause', 'openLedger', 'openPlan', 'openResult', 'openEnding',
  'openExplain', 'openSettings', 'openHistory', 'openNotebook', 'openNotice', 'openTransition', 'openCinematic', 'close',
];

describe('画面の状態（Phase 6 で増えた画面）', () => {
  it('どの画面からでも探索に戻れる（抜け出せない画面がない）', () => {
    for (const start of ALL_MODES) {
      const seen = new Set<UiMode>([start]);
      const queue: UiMode[] = [start];
      while (queue.length > 0) {
        const m = queue.shift()!;
        for (const a of ALL_ACTIONS) {
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

  it('タイトルは Esc・Tab で何も起きない。会話はタイトル・時間経過・演出の裏で始まらない', () => {
    expect(nextMode('title', 'esc')).toBe('title');
    expect(nextMode('title', 'tab')).toBe('title');
    for (const m of ['title', 'transition', 'cinematic', 'settings', 'history'] as UiMode[]) expect(nextMode(m, 'dialogueStarted')).toBe(m);
  });

  it('時間経過の画面は Esc・Tab では閉じず、進めたときだけ閉じる。演出は Esc で飛ばせる', () => {
    expect(nextMode('transition', 'esc')).toBe('transition');
    expect(nextMode('transition', 'close')).toBe('explore');
    expect(nextMode('cinematic', 'esc')).toBe('explore');
  });

  it('設定・記録・解説は、ポーズ・タイトル・結果・エンディングから開け、元に戻る先が決まっている', () => {
    expect(nextMode('pause', 'openSettings')).toBe('settings');
    expect(nextMode('pause', 'openHistory')).toBe('history');
    expect(nextMode('title', 'openSettings')).toBe('settings');
    expect(nextMode('result', 'openHistory')).toBe('history');
    expect(nextMode('ending', 'openHistory')).toBe('history');
    for (const from of ['title', 'pause', 'result', 'ending'] as UiMode[]) {
      const back = RETURN_ACTION[from]!;
      expect(nextMode('explore', back), from).toBe(from);
    }
  });

  it('探索の操作を受け付けるのは探索中だけ', () => {
    expect(ALL_MODES.filter(allowsExploration)).toEqual(['explore']);
  });
});

// ───────── 音の出し分け ─────────

describe('音の出し分け', () => {
  it('水路に近いほど水音が大きく、室内では囲炉裏の火の音になる', () => {
    const near = ambientMix({ x: 10, z: WATERWAY.centerZ, indoor: false });
    const far = ambientMix({ x: 10, z: -30, indoor: false });
    expect(near.water).toBeGreaterThan(far.water);
    expect(far.water).toBeLessThan(0.05);
    const inside = ambientMix({ x: 0, z: 0, indoor: true });
    expect(inside.fire).toBeGreaterThan(0);
    expect(inside.water).toBe(0);
  });

  it('会話中は環境音と音楽を下げる（会話の邪魔をしない）', () => {
    const d = duckFactor('dialogue');
    expect(d.music).toBeLessThan(0.6);
    expect(d.ambient).toBeLessThan(1);
    expect(duckFactor('explore')).toEqual({ ambient: 1, music: 1 });
  });

  it('足音は、室内の板の間・橋の板・土の道で変わる', () => {
    expect(footstepSurface({ x: 0, z: 0, indoor: true })).toBe('wood');
    expect(footstepSurface({ x: BRIDGE.x, z: (BRIDGE.startZ + BRIDGE.endZ) / 2, indoor: false })).toBe('bridge');
    expect(footstepSurface({ x: 0, z: 31, indoor: false })).toBe('dirt');
  });

  it('屋根葺きの日の作業の音：人手が多いほど間隔が短く、離れると小さい', () => {
    const one = workSound({ distance: 5, roofWorkers: 1, indoor: false });
    const three = workSound({ distance: 5, roofWorkers: 3, indoor: false });
    expect(three.interval).toBeLessThan(one.interval);
    expect(workSound({ distance: 60, roofWorkers: 3, indoor: false }).volume).toBe(0);
    expect(workSound({ distance: 5, roofWorkers: 0, indoor: false }).volume).toBe(0);
  });

  it('音楽の雰囲気は章で変わる', () => {
    expect(musicMood('ch1', 'title')).toBe('title');
    expect(musicMood('ch1', 'game')).toBe('village');
    expect(musicMood('roofDay', 'game')).toBe('roofDay');
    expect(musicMood('ch3', 'game')).toBe('later');
    expect(musicMood('end', 'game')).toBe('ending');
  });
});

// ───────── カメラ ─────────

describe('カメラ（初期構図・室内の壁際）', () => {
  it('屋外の最初の構図は、以前（見下ろし 0.42）より低い視点で、屋根まで入りやすい', () => {
    expect(OUTDOOR_FRAMING.pitch).toBeLessThan(0.42);
    expect(OUTDOOR_FRAMING.distance).toBeGreaterThanOrEqual(10);
  });

  it('壁際：今より十分に離せる向きのうち、回る量が小さいものを選ぶ。なければ回らない', () => {
    expect(pickClearYaw(1.0, [{ offset: 0.35, free: 1.2 }, { offset: -0.35, free: 1.1 }])).toBe(0);
    expect(pickClearYaw(1.0, [{ offset: 0.35, free: 3.6 }, { offset: -1.4, free: 3.6 }])).toBe(0.35);
    expect(pickClearYaw(1.0, [{ offset: 0.7, free: 2.0 }, { offset: -0.35, free: 3.5 }])).toBe(-0.35);
  });
});

// ───────── 作業台の要点 ─────────

describe('作業台の要点（見比べ）', () => {
  it('8 つの計画の要点は、それぞれ違う（見比べられる）', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    const texts = Object.values(PLANS).map((p) => glancePlan(p, s).map((g) => g.text).join('|'));
    expect(new Set(texts).size).toBe(8);
    for (const p of Object.values(PLANS)) expect(glancePlan(p, s).map((g) => g.key)).toEqual(['when', 'scope', 'who', 'burden', 'promises']);
  });

  it('知らない事情は「分からない」と示し、未発見の情報を先回りして出さない', () => {
    const little = new StoryState(STORY_DEFS);
    const keepDayOf: PlanSpec = { date: 'keep', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'labor', soheiCover: 'none' };
    const g = glancePlan(keepDayOf, little);
    const who = g.find((x) => x.key === 'who')!;
    expect(who.uncertain).toBe(true);
    expect(who.text).not.toContain('刈り入れ');
    const knows = new StoryState(STORY_DEFS);
    knows.learn('isuke.availability', 'harvest');
    expect(glancePlan(keepDayOf, knows).find((x) => x.key === 'who')!.text).toContain('刈り入れと重なる');
    // 第3幕：足のことを知るまで、サエが上がれないことは出さない
    const roofTop: PlanSpec = { timing: 'now', saeHelp: 'roofTop' };
    expect(glancePlan3(roofTop, little).find((x) => x.key === 'who')!.text).not.toContain('足');
    const knowsLeg = new StoryState(STORY_DEFS);
    knowsLeg.learn('sae.later', 'injured');
    expect(glancePlan3(roofTop, knowsLeg).find((x) => x.key === 'who')!.text).toContain('足');
  });

  it('要点に点数・順位・「おすすめ」の印はない', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    for (const p of Object.values(PLANS)) {
      for (const g of glancePlan(p, s)) expect(g.text).not.toMatch(/おすすめ|正解|最善|点|★/);
    }
  });

  it('情報を知って作業台の選択肢が増えたことを判定できる（重要な発見の意味を伝える）', () => {
    const s = new StoryState(STORY_DEFS);
    const before = unlockedOptions(s);
    s.learn('isuke.availability', 'harvest');
    const after = unlockedOptions(s);
    expect([...after].some((o) => !before.has(o))).toBe(true);
    expect(after.has('roof:date:afterHarvest')).toBe(true);
  });
});

// ───────── 決定と屋根葺きの日の時間の順序 ─────────

describe('計画の決定と「葺き替えた」の時間の順序', () => {
  it.each(OUTCOME_IDS)('%s：決めた時点では葺き替えの記録はなく、一日を終えると付く', (id) => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    expect(consultAndDecide(s, PLANS[id]!)).toBe(id);
    expect(['renewed', 'partial']).not.toContain(s.currentStage('sae.roof'));
    endRoofDay(s);
    expect(s.currentStage('sae.roof')).toBe(parseOutcomeId(id)!.full ? 'renewed' : 'partial');
  });

  it('以前の版で屋根葺きの日の途中に記録したデータ（決めた時点で「葺き替えた」が入っている）は、読み込み時に取り除く', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    consultAndDecide(s, PLANS['solo-full']!);
    s.learn('sae.roof', 'renewed'); // 以前の版の決定の効果
    const text = JSON.stringify(createSave(s.snapshot(), { x: 1, z: 15, heading: 0 }));
    const r = parseSave(text, STORY_DEFS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loaded = new StoryState(STORY_DEFS);
    loaded.restore(r.save.story);
    expect(loaded.currentStage('sae.roof')).not.toBe('renewed');
    // 一日を終えた後の記録・三年後の記録はそのまま
    toChapter3(s);
    const r2 = parseSave(JSON.stringify(createSave(s.snapshot(), { x: 0, z: 26, heading: 0 })), STORY_DEFS);
    expect(r2.ok && r2.save.story.learned.some((l) => l.topic === 'sae.roof' && l.stage === 'renewed')).toBe(true);
  });
});

// ───────── 屋根葺きの日の演出 ─────────

describe('屋根葺きの日の演出は、計画の結果と一致する', () => {
  it.each(OUTCOME_IDS)('%s：着いたときの要約は、来ている人・茅・足場が結果と同じ', (id) => {
    const def = OUTCOMES[id]!;
    const a = roofDayArrival(id)!;
    const text = a.lines.join('');
    expect(text.includes('宗平さん')).toBe('sohei' in def.placements);
    expect(text.includes('伊助さん、') || text.includes('伊助さん。')).toBe('isuke' in def.placements);
    expect(text.includes('ミネさん、') || text.includes('ミネさん。')).toBe('mine' in def.placements);
    const full = parseOutcomeId(id)!.full;
    expect(text.includes('南面いっぱい')).toBe(full);
    expect(text.includes('手持ちの分だけ')).toBe(!full);
    expect(a.when).toBe(def.when);
  });

  it.each(OUTCOME_IDS)('%s：作業は時間とともに進み、人手の少ない計画はその日のうちに終わらない', (id) => {
    const w = roofDayWork(id)!;
    expect(roofDayProgress(w, 0)).toBe(w.start);
    expect(roofDayProgress(w, w.seconds * 2)).toBeCloseTo(w.max, 9);
    expect(roofDayProgress(w, w.seconds / 2)).toBeGreaterThan(w.start);
    expect(w.max < 0.5).toBe(parseOutcomeId(id)!.family === 'solo');
  });

  it.each(OUTCOME_IDS)('%s：ひと言は、作業の場にいない人の口から作業の場のことを言わせない', (id) => {
    const def = OUTCOMES[id]!;
    const barks = roofDayBarks(id);
    expect(Boolean(barks.mine)).toBe('mine' in def.placements);
    if ('isuke' in def.placements) expect(barks.isuke!.join()).not.toContain('稲刈り');
    else expect(barks.isuke!.join()).toMatch(/稲刈り|手が離せん/);
    expect(barks['crew:roof']!.join()).toContain(parseOutcomeId(id)!.full ? '新しい茅' : '傷んだ所だけ');
  });

  it('作業の進み具合は南面の軒先から表れ、北面は変わらない', () => {
    const spec: ThatchRoofSpec = {
      halfSpan: 6.3,
      pitch: THREE.MathUtils.degToRad(58),
      thickness: 0.95,
      halfDepth: 8.3,
      eaveLow: 4.3,
      southSide: -1,
      damage: { zFrom: 0.14, zTo: 0.46, uTo: 0.62 },
      seed: 3,
    };
    const roof = createThatchRoof(spec);
    const colors = () => Float32Array.from((roof.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array);
    const old = colors();
    roof.setWork({ progress: 0.5, full: true });
    const working = colors();
    expect(working).not.toEqual(old);
    roof.setWork(null);
    expect(colors()).toEqual(old);
  });
});

// ───────── 選んだことの記録・エンディング ─────────

describe('選んだことの記録（選択履歴）', () => {
  it('決める前は空。決めた後は選んだこと・承知した人が出て、結果は一日を終えるまで出さない', () => {
    const s = new StoryState(STORY_DEFS);
    expect(buildHistory(s, HISTORY).acts).toHaveLength(0);
    knowingAll(s);
    consultAndDecide(s, PLANS['prep-full']!);
    let h = buildHistory(s, HISTORY);
    expect(h.acts).toHaveLength(1);
    expect(h.acts[0]!.choices.map((c) => c.item)).toContain('日取り');
    expect(h.acts[0]!.agreedBy).toContain('伊助');
    expect(h.acts[0]!.result).toBeNull();
    endRoofDay(s);
    h = buildHistory(s, HISTORY);
    expect(h.acts[0]!.result!.achieved.length).toBeGreaterThan(0);
    expect(h.acts[0]!.result!.remains.length).toBeGreaterThan(0);
  });

  it('「決めたときに分かっていたこと」は、決めた後に知ったことを含まない', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    consultAndDecide(s, PLANS['solo-full']!);
    // 決めた後に知ったこと（伊助の過去の手伝いの別の段階など）を足しても、記録は変わらない
    const before = buildHistory(s, HISTORY).acts[0]!.knownAtDecision;
    s.learn('sae.later', 'injured');
    expect(buildHistory(s, HISTORY).acts[0]!.knownAtDecision).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('断られた案・承諾を得たが選ばなかった案も残る', () => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    // まず断られる案を相談する（予定日に当日の手伝いを頼む → 伊助は断る）
    s.setPlanDraft({ date: 'keep', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' });
    for (const npc of s.planInvolved()) s.consultPlan(npc);
    // 承諾を得た案を二つ作ってから、片方で決める
    s.setPlanDraft(PLANS['solo-part']!);
    for (const npc of s.planInvolved()) s.consultPlan(npc);
    consultAndDecide(s, PLANS['solo-full']!);
    const act = buildHistory(s, HISTORY).acts[0]!;
    expect(act.revisions.some((r) => r.includes('伊助'))).toBe(true);
    expect(act.notChosen.length).toBe(1);
  });

  it.each(['e1', 'e2', 'e3'])('エンディング %s：第1幕と第3幕の両方が記録され、実現したこと・残ったことがある', (ending) => {
    const s = new StoryState(STORY_DEFS);
    knowingAll(s);
    consultAndDecide(s, PLANS['prep-part']!);
    toChapter3(s);
    s.learn('isuke.roof3', 'needsRoof');
    s.learn('sae.later', 'injured');
    const plan3: Record<string, PlanSpec> = {
      e1: { timing: 'now', saeHelp: 'ground' },
      e2: { timing: 'now', saeHelp: 'none' },
      e3: { timing: 'nextYear', saeHelp: 'none' },
    };
    expect(consultAndDecide(s, plan3[ending]!)).toBe(ending);
    const h = buildHistory(s, HISTORY);
    expect(h.acts.map((a) => a.planId)).toEqual(['roof', 'isukeRoof']);
    const act3 = h.acts[1]!;
    expect(act3.result!.achieved.length).toBeGreaterThan(0);
    expect(act3.result!.remains.length).toBeGreaterThan(0);
    // 第1幕の約束は三年のあいだに果たされた（暫定設定）
    expect(h.promises.every((p) => p.kept)).toBe(true);
  });

  it('エンディングの振り返りに点数・評価の言葉を使わない', () => {
    for (const e of Object.values(ENDINGS)) {
      for (const l of [...e.achieved, ...e.remains]) expect(l.text).not.toMatch(/点|成功|失敗|評価|ランク/);
    }
  });
});

// ───────── 史実と創作 ─────────

describe('史実と創作について', () => {
  const section = (id: string) => EXPLAIN.sections.find((s) => s.id === id)!;

  it('確認できる事実・確認中・単純化・架空の人物・創作した設定の区分がある', () => {
    expect(EXPLAIN.sections.map((s) => s.id)).toEqual(['facts', 'pending', 'simplified', 'people', 'settings']);
    expect(EXPLAIN.sources.length).toBeGreaterThan(0);
    for (const s of EXPLAIN.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it('Phase 4 の暫定設定は「創作した設定」にあり、「確認できる事実」には入らない', () => {
    const provisional = ['茅刈りを仕切る役目', '宗平の代わりに茅刈りを仕切れる', '足を痛めている', '約束が、三年のあいだに果たされた'];
    const settings = section('settings').items.join('\n');
    const facts = section('facts').items.join('\n');
    for (const p of provisional) {
      expect(settings, p).toContain(p);
      expect(facts, p).not.toContain(p);
    }
  });

  it('出典で確認できなかった設計の前提（合力との区別・結返し）は、事実ではなく「確認中」に分けている', () => {
    expect(section('pending').items.join()).toContain('合力');
    expect(section('pending').items.join()).toContain('結返し');
    expect(section('facts').items.join()).not.toContain('合力');
  });

  it('架空の人物の名前は「架空の人物」の区分にある', () => {
    const people = section('people').items.join();
    for (const n of ['トキ', 'サエ', '伊助', '宗平', 'ミネ']) expect(people).toContain(n);
  });
});
