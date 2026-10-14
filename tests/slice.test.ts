import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/content/characters';
import { DIALOGUES } from '../src/content/dialogues';
import { INTERACTABLES } from '../src/content/interactables';
import { LEDGER } from '../src/content/ledger';
import { currentObjective } from '../src/content/objectives';
import { INITIAL_PLAN, OUTCOMES, PLANNING, RELEVANT_TOPICS, RESPONSE_SUMMARY, forecastPlan } from '../src/content/plan';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { buildLedger, buildNotebook } from '../src/journal/models';
import { buildOutcome, buildPlanBoard, type PlanSources } from '../src/journal/planModels';
import { createSave, parseSave } from '../src/save/saveData';
import { StoryState } from '../src/story/StoryState';

/**
 * 縦切り試作（docs/VERTICAL_SLICE.md）の一連の流れ。
 * 探索 → 事情の理解 → 計画 → 相談 → 計画の見直し → 結果 が成立し、
 * 選択によって異なる結果に到達することを確かめる。
 */

const src: PlanSources = {
  characters: CHARACTERS,
  households: HOUSEHOLDS,
  planSummaries: RESPONSE_SUMMARY,
  summaries: RESPONSE_SUMMARY,
  outcomes: OUTCOMES,
  forecast: forecastPlan,
  relevantTopics: RELEVANT_TOPICS,
};

function newGame() {
  const story = new StoryState(STORY_DEFS);
  return { story, sys: new InteractionSystem(INTERACTABLES, DIALOGUES, story) };
}

type Picker = (choices: readonly string[]) => number;

function talk(sys: InteractionSystem, id: string, pick: Picker = (c) => c.length - 1): string[] {
  const def = INTERACTABLES.find((i) => i.id === id)!;
  sys.updateTarget({ x: def.position.x, z: def.position.z - 1, heading: 0 });
  expect(sys.target?.id).toBe(id);
  sys.interact();
  const seen: string[] = [];
  for (let guard = 0; sys.isActive; guard++) {
    if (guard > 100) throw new Error(`${id} の会話が終わらない`);
    const view = sys.view!;
    seen.push(view.text);
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

const consult = (sys: InteractionSystem, npc: 'sae' | 'isuke') =>
  talk(sys, npc, say('作業台でまとめた案', npc === 'sae' ? 'この案でいいですか' : 'この案で手伝って'));

const board = (story: StoryState) => buildPlanBoard(story, src);
const optionIds = (story: StoryState, item: string) =>
  board(story).items.find((i) => i.id === item)!.options.map((o) => o.id);

describe('縦切り試作：探索 → 計画 → 相談 → 見直し → 結果', () => {
  it('伊助の事情を調べ、相談の返事を受けて案を見直し、前日準備の分担（R2）に至る', () => {
    const { story, sys } = newGame();
    // 屋根の問題を知る
    talk(sys, 'sae', say('誰に声を'));
    talk(sys, 'saeRoof');
    expect(story.currentStage('sae.roof')).toBe('worn');

    // 作業台：最初はサエの元の案（予定日・伊助に当日）しか考えられない
    story.setPlanDraft(INITIAL_PLAN);
    expect(optionIds(story, 'date')).toEqual(['keep']);
    expect(optionIds(story, 'isuke')).toEqual(['none', 'dayOf']);
    expect(optionIds(story, 'offer')).toEqual(['none']);
    expect(board(story).items.every((i) => i.hidden > 0 || i.id === 'isuke')).toBe(true);

    // 伊助に相談 → 断られる（理由は教えてもらえない）
    const first = consult(sys, 'isuke');
    expect(first.join()).toContain('こっちにも都合がある');
    expect(story.planPhase()).toBe('revise');
    expect(story.planResponse('isuke')?.status).toBe('declined');

    // 畑を調べる → 伊助から事情を聞く → もう一度畑を見る → 詳しく聞く
    talk(sys, 'hasaRack');
    talk(sys, 'isuke', say('はさ掛け'));
    expect(story.currentStage('isuke.availability')).toBe('harvest');
    talk(sys, 'hasaRack');
    expect(story.currentStage('isuke.field')).toBe('progress');
    talk(sys, 'isuke', say('抜けられませんか'));
    expect(story.currentStage('isuke.availability')).toBe('dayBefore');
    // 結帳で過去の協力を知る
    talk(sys, 'ledger');
    expect(story.currentStage('isuke.pastHelp')).toBe('onRecord');

    // 情報を得たので、案の選択肢が増えた
    expect(optionIds(story, 'date')).toEqual(['keep', 'afterHarvest']);
    expect(optionIds(story, 'isuke')).toEqual(['none', 'dayOf', 'dayBefore']);
    expect(optionIds(story, 'offer')).toEqual(['none', 'harvestHelp']);

    // 前日の準備だけ頼む案 → 条件付き（刈り入れの遅れをどうするか）
    story.setPlanDraft({ ...story.planDraft()!, isuke: 'dayBefore' });
    expect(story.planPhase()).toBe('pending');
    // 結帳の記録を持ち出しても、返事は変わらない（過去の協力と現在の同意は別）
    const appeal = talk(sys, 'isuke', say('作業台でまとめた案', '十二年前の手伝いを持ち出して', 'この案で手伝って'));
    expect(appeal.join()).toContain('それとこれとは別の話だ');
    expect(story.planResponse('isuke')).toMatchObject({ status: 'conditional', reason: 'needsCover' });
    expect(story.planPhase()).toBe('revise');

    // 見直し：刈り入れの手伝いを申し出る
    story.setPlanDraft({ ...story.planDraft()!, offer: 'harvestHelp' });
    expect(story.planPhase()).toBe('pending');
    expect(board(story).canDecide).toBe(false);
    consult(sys, 'isuke');
    expect(story.planResponse('isuke')).toMatchObject({ status: 'agreed', reason: 'prepWithHelp' });
    const sae = consult(sys, 'sae');
    expect(sae.join()).toContain('頼むだけというのは気が引ける');
    expect(story.planPhase()).toBe('ready');
    expect(currentObjective(story)).toContain('作業台で計画を決める');

    // 決定 → 結果
    expect(story.decidePlan()).toBe('r2');
    expect(story.allPromises().map((p) => p.id)).toEqual(['saeHelpsIsukeHarvest']);
    expect(story.consentStatus('isuke', 'roofPrep')).toBe('agreed');
    // 当日の手伝いは断ったまま（前日の準備とは別の依頼）
    expect(story.consentStatus('isuke', 'roofDay')).toBe('declined');
    expect(story.currentStage('sae.roof')).toBe('renewed');
    const view = buildOutcome(story, OUTCOMES)!;
    expect(view.title).toBe('前日の準備を分け合って');
    expect(view.costs.join()).toContain('新しい約束が重なった');
    expect(view.costs.join()).toContain('刈り入れを手伝う約束');

    // 決定後は案を変えられず、住民の台詞が変わる
    expect(story.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'none' })).toBe(false);
    expect(talk(sys, 'isuke')[0]).toContain('サエさんが手伝いに来てくれとる');
    expect(talk(sys, 'toki')[0]).toContain('伊助さんの田んぼに出てる');
    expect(currentObjective(story)).toContain('屋根葺きを終えた村');

    // 結帳に今年の記録と約束が書き加わる
    const ledger = buildLedger(story, [...LEDGER, OUTCOMES.r2!.ledger], src);
    expect(ledger.entries.map((e) => e.id)).toEqual(['L1', 'L2', 'L3']);
    expect(ledger.promises.map((p) => `${p.from}→${p.to}`)).toEqual(['サエ家→伊助家']);
  });

  it('情報をほとんど集めなくても、予定どおり伊助に頼まない計画（R1）で終えられる。知らなかったことは結果に表れる', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    story.setPlanDraft(INITIAL_PLAN);
    story.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'none' });
    expect(story.planInvolved()).toEqual(['sae']);
    consult(sys, 'sae');
    expect(story.planPhase()).toBe('ready');
    expect(story.decidePlan()).toBe('r1');
    const view = buildOutcome(story, OUTCOMES)!;
    expect(view.story.join()).toContain('伊助さんには、最後まで声をかけなかった');
    expect(view.story.join()).not.toContain('畑で稲を刈っていた');
    expect(story.allPromises()).toEqual([]);
    expect(talk(sys, 'isuke')[0]).toContain('サエさんの屋根、葺き替わったな');
  });

  it('同じ R1 でも、伊助の事情を知っていたかどうかで結果の文章が変わる', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    talk(sys, 'isuke');
    talk(sys, 'hasaRack');
    talk(sys, 'isuke', say('はさ掛け'));
    story.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'none' });
    consult(sys, 'sae');
    story.decidePlan();
    const text = buildOutcome(story, OUTCOMES)!.story.join();
    expect(text).toContain('畑で稲を刈っていた');
    expect(text).not.toContain('聞けずじまい');
  });

  it('刈り入れの後に延ばす計画（R3）では、伊助が当日加わり、屋根の傷みが進む', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    talk(sys, 'isuke');
    talk(sys, 'hasaRack');
    talk(sys, 'isuke', say('はさ掛け'));
    story.setPlanDraft({ date: 'afterHarvest', isuke: 'none', offer: 'none' });
    // 伊助が来ないのに延ばす案は、サエが断る
    consult(sys, 'sae');
    expect(story.planResponse('sae')).toMatchObject({ status: 'declined', reason: 'pointlessDelay' });
    expect(story.decidePlan()).toBeNull();

    story.setPlanDraft({ date: 'afterHarvest', isuke: 'dayOf', offer: 'none' });
    consult(sys, 'sae');
    consult(sys, 'isuke');
    expect(story.planResponse('sae')?.reason).toBe('delayWorry');
    expect(story.decidePlan()).toBe('r3');
    expect(story.history('sae.roof').map((h) => h.stage)).toEqual(['worse', 'renewed']);
    // 本人が新しい日程で承諾したので、当日の手伝いの意向が変わる（履歴は残る）
    expect(story.consentHistory('isuke').map((c) => `${c.request}:${c.status}`)).toEqual([
      'roofDay:declined',
      'roofDay:agreed',
    ]);
    expect(buildOutcome(story, OUTCOMES)!.when).toBe('十日後');
  });

  it('結果は少なくとも 4 種類あり、それぞれ状態の変化が異なる', () => {
    const plans = {
      r1: { date: 'keep', isuke: 'none', offer: 'none' },
      r2: { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp' },
      r3: { date: 'afterHarvest', isuke: 'dayOf', offer: 'none' },
      r3help: { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp' },
    };
    const results = Object.entries(plans).map(([id, plan]) => {
      const story = new StoryState(STORY_DEFS);
      story.setPlanDraft(plan);
      for (const npc of story.planInvolved()) story.consultPlan(npc);
      expect(story.decidePlan(), id).toBe(id);
      return JSON.stringify({
        promises: story.allPromises().map((p) => p.id),
        roof: story.history('sae.roof').map((h) => h.stage),
        isuke: story.consentHistory('isuke').map((c) => `${c.request}:${c.status}`),
        ledger: OUTCOMES[id]!.ledger.items.map((i) => `${i.from}>${i.to}:${i.settlement}`),
      });
    });
    expect(new Set(results).size).toBe(4);
  });
});

describe('相談と承諾の規則', () => {
  it('返事は案の内容だけで決まる：過去の記録・会話の回数・情報の有無で変わらない', () => {
    const plan = { date: 'keep', isuke: 'dayBefore', offer: 'none' };
    const a = new StoryState(STORY_DEFS);
    const b = new StoryState(STORY_DEFS);
    b.learn('isuke.pastHelp', 'isukeView');
    b.learn('ledger.basics', 'read');
    b.setConsent('isuke', 'roofDay', 'declined');
    for (const s of [a, b]) {
      s.setPlanDraft(plan);
      s.consultPlan('isuke');
    }
    expect(a.planResponse('isuke')).toMatchObject({ status: 'conditional', reason: 'needsCover' });
    expect(b.planResponse('isuke')).toMatchObject({ status: 'conditional', reason: 'needsCover' });
  });

  it('承諾していない住民がいる案は決定できない', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft(INITIAL_PLAN);
    expect(story.decidePlan()).toBeNull(); // 未相談
    story.consultPlan('sae');
    expect(story.planPhase()).toBe('pending');
    expect(story.decidePlan()).toBeNull();
    story.consultPlan('isuke');
    expect(story.planPhase()).toBe('revise'); // 伊助が断った
    expect(story.decidePlan()).toBeNull();
    expect(story.planDecision()).toBeNull();
  });

  it('案を変えると、その案についての相談は最初から。前の案に戻せば前の返事が有効になる', () => {
    const story = new StoryState(STORY_DEFS);
    const p1 = { date: 'keep', isuke: 'none', offer: 'none' };
    const p2 = { date: 'afterHarvest', isuke: 'dayOf', offer: 'none' };
    story.setPlanDraft(p1);
    story.consultPlan('sae');
    expect(story.planPhase()).toBe('ready');
    story.setPlanDraft(p2);
    expect(story.planPhase()).toBe('pending');
    expect(story.isPlanPending('sae')).toBe(true);
    expect(story.isPlanPending('isuke')).toBe(true);
    story.setPlanDraft(p1);
    expect(story.planPhase()).toBe('ready');
    // 相談し直しても返事は増えない（同じ案には同じ返事）
    story.consultPlan('sae');
    expect(story.planResponses()).toHaveLength(1);
    // 作業台には以前の案への返事が比較のため残る
    story.setPlanDraft(p2);
    expect(board(story).past.map((p) => p.name)).toEqual(['サエ']);
  });

  it('成り立たない組み合わせ（頼まないのに手伝いを申し出る）は相談できず、理由が示される', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'harvestHelp' });
    expect(board(story).invalidReason).toContain('伊助にも相談する案');
    expect(story.planInvolved()).toEqual([]);
    expect(story.consultPlan('sae')).toBeNull();
    expect(story.planPhase()).toBe('revise');
  });

  it('関係ない住民には相談しない・定義にない選択肢は受け付けない', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'none' });
    expect(story.consultPlan('isuke')).toBeNull();
    expect(story.consultPlan('mine')).toBeNull();
    expect(() => story.setPlanDraft({ date: 'tomorrow', isuke: 'none', offer: 'none' })).toThrow();
  });

  it('手帳の人物欄に、今の案への返事が出る', () => {
    const { story, sys } = newGame();
    talk(sys, 'sae');
    talk(sys, 'isuke');
    story.setPlanDraft(INITIAL_PLAN);
    let isuke = buildNotebook(story, src).people.find((p) => p.id === 'isuke')!;
    expect(isuke.plan?.status).toBe('まだ相談していない');
    consult(sys, 'isuke');
    isuke = buildNotebook(story, src).people.find((p) => p.id === 'isuke')!;
    expect(isuke.plan).toEqual({ status: '断っている', summary: '屋根葺きの日は刈り入れと重なる' });
  });
});

describe('計画の保存・読込', () => {
  function roundTrip(story: StoryState) {
    const parsed = parseSave(JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })), STORY_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error();
    const restored = new StoryState(STORY_DEFS);
    restored.restore(parsed.save.story);
    return { restored, warnings: parsed.warnings, text: JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })) };
  }

  it('相談の途中・決定後のどちらも、案・返事・決定・約束が復元される', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft({ date: 'keep', isuke: 'dayBefore', offer: 'none' });
    story.consultPlan('isuke');
    let { restored, warnings } = roundTrip(story);
    expect(warnings).toEqual([]);
    expect(restored.planPhase()).toBe('revise');
    expect(restored.planResponse('isuke')?.reason).toBe('needsCover');

    story.setPlanDraft({ date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp' });
    story.consultPlan('isuke');
    story.consultPlan('sae');
    story.decidePlan();
    ({ restored, warnings } = roundTrip(story));
    expect(warnings).toEqual([]);
    expect(restored.snapshot()).toEqual(story.snapshot());
    expect(restored.outcome()).toBe('r2');
    expect(restored.allPromises().map((p) => p.id)).toEqual(['saeHelpsIsukeHarvest']);
    expect(restored.setPlanDraft({ date: 'keep', isuke: 'none', offer: 'none' })).toBe(false);
  });

  it('版 1 の記録は「計画なし」として読み込める', () => {
    const story = new StoryState(STORY_DEFS);
    story.learn('sae.schedule', 'needsHelp');
    const v1 = JSON.parse(JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })));
    v1.version = 1;
    delete v1.story.plan;
    const parsed = parseSave(JSON.stringify(v1), STORY_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.save.story.plan).toEqual({ draft: null, responses: [], decision: null });
  });

  it('規則と合わない返事は読み飛ばし、承諾のない決定は破損として扱う', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft(INITIAL_PLAN);
    story.consultPlan('isuke');
    const d = JSON.parse(JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })));
    // 伊助が承諾したことに書き換えられた記録
    d.story.plan.responses[0].status = 'agreed';
    const parsed = parseSave(JSON.stringify(d), STORY_DEFS);
    expect(parsed.ok && parsed.warnings.length).toBe(1);
    if (parsed.ok) expect(parsed.save.story.plan.responses).toEqual([]);

    // 承諾のないまま決定したことになっている記録
    const e = JSON.parse(JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })));
    e.story.plan.decision = { plan: { date: 'keep', isuke: 'none', offer: 'none' }, outcome: 'r1', order: 99 };
    expect(parseSave(JSON.stringify(e), STORY_DEFS)).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  it('定義にない選択肢を含む案は読み飛ばす', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft(INITIAL_PLAN);
    const d = JSON.parse(JSON.stringify(createSave(story.snapshot(), { x: 0, z: 0, heading: 0 })));
    d.story.plan.draft.date = 'nextYear';
    const parsed = parseSave(JSON.stringify(d), STORY_DEFS);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.save.story.plan.draft).toBeNull();
  });
});

describe('計画の定義', () => {
  it('どの段階でも「予定日・伊助に頼まない」は選べ、サエは承諾する（進行不能にならない）', () => {
    const story = new StoryState(STORY_DEFS);
    story.setPlanDraft(INITIAL_PLAN);
    expect(optionIds(story, 'date')).toContain('keep');
    expect(optionIds(story, 'isuke')).toContain('none');
    expect(PLANNING.respond('sae', { date: 'keep', isuke: 'none', offer: 'none' }).status).toBe('agreed');
  });

  it('すべての組み合わせについて、返事・結果の規則が定義どおりに動く', () => {
    let decidable = 0;
    for (const date of ['keep', 'afterHarvest'])
      for (const isuke of ['none', 'dayOf', 'dayBefore'])
        for (const offer of ['none', 'harvestHelp']) {
          const plan = { date, isuke, offer };
          if (PLANNING.invalidReason(plan) !== null) continue;
          const allAgree = PLANNING.involved(plan).every((n) => PLANNING.respond(n, plan).status === 'agreed');
          const outcome = PLANNING.outcome(plan);
          // 全員が承諾する案だけに結果があり、結果のある案は全員が承諾する
          expect(outcome !== null, JSON.stringify(plan)).toBe(allAgree);
          if (outcome) {
            decidable++;
            expect(OUTCOMES[outcome]).toBeDefined();
          }
          for (const n of PLANNING.involved(plan)) expect(RESPONSE_SUMMARY[PLANNING.respond(n, plan).reason]).toBeDefined();
        }
    expect(decidable).toBe(4);
  });
});
