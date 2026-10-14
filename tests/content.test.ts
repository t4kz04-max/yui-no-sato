import { describe, expect, it } from 'vitest';
import { penetration } from '../src/core/collision';
import { createRandom } from '../src/core/random';
import { CHARACTERS } from '../src/content/characters';
import { DIALOGUES } from '../src/content/dialogues';
import { INTERACTABLES, NPCS, NPC_COLLIDER_RADIUS, npcColliders } from '../src/content/interactables';
import { LEDGER } from '../src/content/ledger';
import { OBJECTIVES, currentObjective } from '../src/content/objectives';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { INITIAL_PLAN, OUTCOMES, OUTCOME_IDS, PLAN_ROOF, PLANNING_AVAILABLE } from '../src/content/plan';
import { ENDINGS, INITIAL_PLAN3, MEANWHILE, PLAN_ISUKE_ROOF } from '../src/content/plan3';
import { PROMISES_KEPT_BY_CH3 } from '../src/content/chronicle';
import { validateScript } from '../src/dialogue/validate';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { completionFlag } from '../src/interaction/types';
import { collectRefs, evaluate, knows, type Condition, type Effect } from '../src/story/conditions';
import { StoryState } from '../src/story/StoryState';
import type { FlagId } from '../src/story/types';
import { createSave, parseSave } from '../src/save/saveData';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, LOCATIONS, PATHS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, distanceToSegment } from '../src/world/layout';
import { buildReachability } from './helpers/reachability';

/**
 * 会話・調査・物語の定義データ（src/content）の整合性テスト。
 * docs/STATE_TABLE.md と実データが食い違ったり、進行不能・矛盾が起きたりしないことを確かめる。
 */

const speakers = new Set(Object.keys(CHARACTERS));

/** すべての会話データの条件と効果を集める。 */
function collectAll() {
  const conditions: Condition[] = [];
  const effects: Effect[] = [];
  for (const script of Object.values(DIALOGUES)) {
    for (const e of script.entries) if (e.when) conditions.push(e.when);
    for (const node of Object.values(script.nodes)) {
      effects.push(...(node.effects ?? []));
      for (const c of node.choices ?? []) {
        if (c.when) conditions.push(c.when);
        effects.push(...(c.effects ?? []));
      }
    }
  }
  for (const o of OBJECTIVES) if (o.when) conditions.push(o.when);
  // 計画を決めたときの効果（結果）もゲーム中に起きる
  for (const id of OUTCOME_IDS) effects.push(...PLAN_ROOF.outcomeEffects(id));
  for (const id of Object.keys(ENDINGS)) effects.push(...PLAN_ISUKE_ROOF.outcomeEffects(id));
  for (const o of Object.values(OUTCOMES)) for (const l of [...o.story, ...o.achieved, ...o.costs]) if (l.when) conditions.push(l.when);
  for (const e of Object.values(ENDINGS)) for (const l of e.story) if (l.when) conditions.push(l.when);
  for (const l of MEANWHILE) if (l.when) conditions.push(l.when);
  for (const planning of [PLAN_ROOF, PLAN_ISUKE_ROOF]) for (const item of planning.items) for (const o of item.options) if (o.when) conditions.push(o.when);
  // 章の進行で立つフラグ（Game が立てる）
  effects.push({ type: 'setFlag', flag: 'kept:saeHelpsIsukeHarvest' }, { type: 'setFlag', flag: 'kept:saeReturnsKaya' });
  return { conditions, effects };
}

describe('会話データ', () => {
  it.each(Object.entries(DIALOGUES))('「%s」の構造に問題がない', (_, script) => {
    expect(validateScript(script, speakers)).toEqual([]);
  });

  it('会話 ID とキーが一致する', () => {
    for (const [key, script] of Object.entries(DIALOGUES)) expect(script.id).toBe(key);
  });

  it('条件で参照するフラグ・情報・意向は、すべて定義されていて、ゲーム中に得られるもの', () => {
    const { conditions, effects } = collectAll();
    const producibleFlags = new Set<FlagId>();
    for (const def of INTERACTABLES) producibleFlags.add(completionFlag(def));
    for (const loc of LOCATIONS) producibleFlags.add(`visited:${loc.id}`);
    const learnable = new Set<string>();
    const consentable = new Set<string>();
    for (const e of effects) {
      if (e.type === 'setFlag') producibleFlags.add(e.flag);
      if (e.type === 'learn') learnable.add(`${e.topic}/${e.stage}`);
      if (e.type === 'setConsent') consentable.add(`${e.npc}/${e.request}`);
    }
    const problems: string[] = [];
    for (const c of conditions) {
      const refs = collectRefs(c);
      for (const f of refs.flags) if (!producibleFlags.has(f)) problems.push(`得られないフラグ ${f}`);
      for (const t of refs.topics) {
        const def = STORY_DEFS.topics[t.topic];
        if (!def) problems.push(`未定義の情報 ${t.topic}`);
        else if (t.stage && !def.stages.some((s) => s.id === t.stage)) problems.push(`未定義の段階 ${t.topic}/${t.stage}`);
        else if (t.stage && !learnable.has(`${t.topic}/${t.stage}`)) problems.push(`得られない段階 ${t.topic}/${t.stage}`);
      }
      for (const r of refs.consents) {
        if (!STORY_DEFS.npcs.includes(r.npc) || !STORY_DEFS.requests[r.request]) problems.push(`未定義の意向 ${r.npc}/${r.request}`);
        else if (!consentable.has(`${r.npc}/${r.request}`)) problems.push(`記録されない意向 ${r.npc}/${r.request}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('効果で使う情報・住民・依頼はすべて定義されている', () => {
    const { effects } = collectAll();
    for (const e of effects) {
      if (e.type === 'learn') {
        expect(STORY_DEFS.topics[e.topic]?.stages.some((s) => s.id === e.stage), `${e.topic}/${e.stage}`).toBe(true);
      }
      if (e.type === 'setConsent') {
        expect(STORY_DEFS.npcs).toContain(e.npc);
        expect(STORY_DEFS.requests[e.request]).toBeDefined();
      }
    }
  });

  it('定義した情報の段階は、すべてどこかで得られる（手帳に載らない死んだ定義がない）', () => {
    const learnable = new Set(collectAll().effects.flatMap((e) => (e.type === 'learn' ? [`${e.topic}/${e.stage}`] : [])));
    for (const t of Object.values(STORY_DEFS.topics)) {
      for (const s of t.stages) expect(learnable.has(`${t.id}/${s.id}`), `${t.id}/${s.id}`).toBe(true);
    }
  });
});

describe('物語の定義', () => {
  it('情報の人物・家の人物・結帳の当事者と関連情報が定義と一致する', () => {
    for (const t of Object.values(STORY_DEFS.topics)) {
      if (t.person) expect(STORY_DEFS.npcs).toContain(t.person);
      expect(t.stages.length).toBeGreaterThan(0);
      expect(new Set(t.stages.map((s) => s.id)).size).toBe(t.stages.length);
    }
    for (const h of Object.values(HOUSEHOLDS)) if (h.person) expect(STORY_DEFS.npcs).toContain(h.person);
    const itemIds = new Set<string>();
    for (const entry of LEDGER) {
      for (const t of entry.relatedTopics) expect(STORY_DEFS.topics[t], t).toBeDefined();
      for (const item of entry.items) {
        expect(STORY_DEFS.households).toContain(item.from);
        expect(STORY_DEFS.households).toContain(item.to);
        expect(itemIds.has(item.id)).toBe(false);
        itemIds.add(item.id);
      }
    }
  });
});

describe('インタラクション対象の定義', () => {
  it('ID が重複せず、会話データと人物が存在する', () => {
    const ids = INTERACTABLES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of INTERACTABLES) {
      expect(DIALOGUES[def.dialogue], def.id).toBeDefined();
      if (def.kind === 'npc') expect(speakers.has(def.character), def.id).toBe(true);
    }
  });

  it('設計書 D 節の5人が村に配置されている', () => {
    expect(NPCS.map((n) => n.character).sort()).toEqual(Object.keys(CHARACTERS).sort());
  });

  it('結帳は村の中の物として調べられ、調べると専用画面が開く', () => {
    const ledger = INTERACTABLES.find((i) => i.id === 'ledger');
    expect(ledger?.kind).toBe('object');
    expect(ledger?.kind === 'object' && ledger.opens).toBe('ledger');
  });
});

describe('住民と調査対象の配置', () => {
  const world = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
  const radius = DEFAULT_PLAYER_TUNING.radius;

  it('住民は建物・木・小物と重ならない', () => {
    for (const npc of NPCS) {
      for (const c of world) {
        expect(penetration(npc.position, NPC_COLLIDER_RADIUS, c), npc.id).toBeNull();
      }
    }
  });

  it('住民は道をふさがない', () => {
    for (const npc of NPCS) {
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          const d = distanceToSegment(npc.position.x, npc.position.z, path.points[i]!, path.points[i + 1]!);
          expect(d, npc.id).toBeGreaterThan(path.width / 2 + NPC_COLLIDER_RADIUS + 0.2);
        }
      }
    }
  });

  const map = buildReachability([...world, ...npcColliders()], WALK_BOUNDS, PLAYER_START.position, radius);

  it.each(INTERACTABLES.map((i) => [i.label, i] as const))(
    'スタート地点から歩いて「%s」に話しかけられる・調べられる位置まで行ける',
    (_, def) => {
      // 格子の間隔（0.5m）の分だけ余裕を見る
      expect(map.nearestReachable(def.position)).toBeLessThan(def.range - 0.4);
    },
  );
});

describe('目的表示', () => {
  it('最後の目的は条件なし（必ず何か表示される）', () => {
    expect(OBJECTIVES[OBJECTIVES.length - 1]?.when).toBeUndefined();
  });

  it('進行に応じて目的が変わる', () => {
    const s = new StoryState(STORY_DEFS);
    expect(currentObjective(s)).toBe('広場にいるトキに話しかける');
    s.set('talked:toki');
    expect(currentObjective(s)).toBe('サエ家を訪ねる');
    s.set('talked:sae');
    expect(currentObjective(s)).toBe('伊助に屋根葺きの手伝いを相談する');
  });
});

// ───────── シナリオの通し確認 ─────────

/** 対象の正面に立って話しかけ、選択肢を pick で選びながら最後まで進める。 */
function talk(sys: InteractionSystem, id: string, pick: (choices: readonly string[]) => number = () => 0): string[] {
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

const choose = (text: string) => (c: readonly string[]) => {
  const i = c.findIndex((x) => x.includes(text));
  if (i < 0) throw new Error(`選択肢「${text}」がない：${c.join(' / ')}`);
  return i;
};
/** 出てきた選択肢を、指定した文言の順に選ぶ。 */
const sequence = (...texts: string[]) => {
  let i = 0;
  return (c: readonly string[]) => choose(texts[i++] ?? '')(c);
};
const last = (c: readonly string[]) => c.length - 1;

function newGame() {
  const story = new StoryState(STORY_DEFS);
  return { story, sys: new InteractionSystem(INTERACTABLES, DIALOGUES, story) };
}

describe('仮シナリオの通し確認', () => {
  it('すべての住民・調査対象と、どの選択肢を選んでも会話を終えられる', () => {
    for (const choiceIndex of [0, 1, 2, 3]) {
      const { story, sys } = newGame();
      for (let round = 0; round < 3; round++) {
        for (const def of INTERACTABLES) talk(sys, def.id, (c) => Math.min(choiceIndex, c.length - 1));
      }
      for (const def of INTERACTABLES) expect(story.has(completionFlag(def))).toBe(true);
    }
  });

  it('伊助の事情：はさ掛けを調べた後でなければ聞けず、手帳の記述が段階的に更新される', () => {
    const { story, sys } = newGame();
    const choicesSeen: string[][] = [];
    talk(sys, 'isuke', (c) => {
      choicesSeen.push([...c]);
      return last(c);
    });
    expect(choicesSeen[0]).not.toContain('畑のはさ掛けを見てきました');
    expect(story.currentStage('isuke.availability')).toBe('declined');
    expect(story.consentStatus('isuke', 'roofDay')).toBe('declined');

    // 断られた後、トキが畑を見るよう勧める（未確認の情報は話さない）
    const tokiLines = talk(sys, 'toki');
    expect(tokiLines.join()).toContain('畑のほう');
    expect(tokiLines.join()).not.toContain('刈り入れ');

    talk(sys, 'hasaRack');
    expect(story.currentStage('isuke.field')).toBe('harvesting');

    const lines = talk(sys, 'isuke', choose('はさ掛け'));
    expect(lines.join()).toContain('刈り入れ');
    expect(story.history('isuke.availability').map((h) => h.stage)).toEqual(['declined', 'harvest']);
    expect(story.history('isuke.availability')[1]?.source).toBe('伊助と話した');
    // 事情を知った後は、伊助の最初の台詞も変わる。意向（断っている）はそのまま
    expect(talk(sys, 'isuke', last)[0]).toContain('刈り入れが済むまでは');
    expect(story.consentStatus('isuke', 'roofDay')).toBe('declined');
  });

  it('結帳を読むと、過去の協力について伊助に聞けるようになる（過去の記録は現在の意向を変えない）', () => {
    const { story, sys } = newGame();
    talk(sys, 'isuke', last);
    let choices: string[] = [];
    talk(sys, 'isuke', (c) => ((choices = [...c]), last(c)));
    expect(choices.some((c) => c.includes('十二年前'))).toBe(false);

    // 結帳は最初から読める（設計書 G：探索順は固定しない）
    talk(sys, 'ledger');
    expect(story.currentStage('ledger.basics')).toBe('read');
    expect(story.currentStage('isuke.pastHelp')).toBe('onRecord');

    const lines = talk(sys, 'isuke', choose('十二年前'));
    expect(lines.join()).toContain('今年の刈り入れが待ってくれるわけじゃない');
    expect(story.currentStage('isuke.pastHelp')).toBe('isukeView');
    expect(story.consentStatus('isuke', 'roofDay')).toBe('declined');
  });

  it('ミネの控えは、ミネの許可を得るまで読めない', () => {
    const { story, sys } = newGame();
    expect(talk(sys, 'mineRecords').join()).toContain('断らずに読むわけにはいかない');
    expect(story.topicRank('mine.kaya')).toBe(-1);

    talk(sys, 'mine', sequence('どうしたら', 'また来ます'));
    expect(story.currentStage('mine.kaya')).toBe('returnTerms');
    expect(story.consentStatus('mine', 'lendKaya')).toBe('conditional');
    // 「どうしたら」の続きで控えを頼む
    talk(sys, 'mine', choose('控え'));
    expect(story.consentStatus('mine', 'showRecords')).toBe('agreed');

    expect(talk(sys, 'mineRecords').join()).toContain('茅二十束');
    expect(story.history('mine.kaya').map((h) => h.stage)).toEqual(['reluctant', 'returnTerms', 'whyRecord']);
  });
});

describe('取得順序・中断に対する一貫性（無作為な遊び方 400 通り、全章）', () => {
  const PLANS = { roof: PLAN_ROOF, isukeRoof: PLAN_ISUKE_ROOF } as const;

  /** 状態が満たすべき条件（docs/STATE_TABLE.md・docs/PHASE4_DESIGN.md の前提関係）。 */
  function checkInvariants(story: StoryState): string[] {
    const problems: string[] = [];
    const orderOf = (topic: string, stage: string) => story.history(topic).find((h) => h.stage === stage)?.order;
    // 情報の段階は進むだけ
    for (const id of Object.keys(STORY_DEFS.topics)) {
      const ranks = story.history(id).map((h) => story.stageRank(id, h.stage));
      if (ranks.some((r, i) => i > 0 && r <= ranks[i - 1]!)) problems.push(`${id} の段階が後退した`);
    }
    // 前提となる情報を先に得ている
    const before = (aTopic: string, aStage: string, bTopic: string, bStage: string) => {
      const b = orderOf(bTopic, bStage);
      if (b === undefined) return;
      const a = orderOf(aTopic, aStage);
      if (a === undefined || a > b) problems.push(`${bTopic}/${bStage} を ${aTopic}/${aStage} より先に得た`);
    };
    before('isuke.field', 'harvesting', 'isuke.availability', 'harvest');
    before('isuke.pastHelp', 'onRecord', 'isuke.pastHelp', 'isukeView');
    before('mine.kaya', 'returnTerms', 'mine.kaya', 'whyRecord');
    const why = orderOf('mine.kaya', 'whyRecord');
    const permission = story.consent('mine', 'showRecords');
    if (why !== undefined && (!permission || permission.status !== 'agreed' || permission.order > why)) {
      problems.push('許可なくミネの控えを読んだ');
    }
    for (const npc of STORY_DEFS.npcs) {
      if (story.consentHistory(npc).length > 0 && !story.hasMet(npc)) problems.push(`${npc} に会わずに意向が記録された`);
    }
    if (currentObjective(story) === '') problems.push('目的が空');

    // ── 計画（章ごと） ──
    for (const [planId, planning] of Object.entries(PLANS)) {
      const sig = (p: Record<string, string>) => story.planSignature(p, planId);
      for (const r of story.planResponses(planId)) {
        const rule = planning.respond(r.npc, r.plan);
        if (rule.status !== r.status || rule.reason !== r.reason) problems.push(`規則と違う返事 ${planId}/${r.npc}`);
        if (!planning.involved(r.plan).includes(r.npc)) problems.push(`相談の必要がない人の返事 ${planId}/${r.npc}`);
      }
      const d = story.planDecision(planId);
      if (d) {
        // 決定した案は、関係者全員が承諾している（承諾していない住民を承諾済みとして扱わない）
        for (const npc of planning.involved(d.plan)) {
          const ok = story
            .planResponses(planId)
            .some((r) => r.npc === npc && sig(r.plan) === sig(d.plan) && r.status === 'agreed' && r.order < d.order);
          if (!ok) problems.push(`承諾のない決定 ${planId}/${npc}`);
        }
        if (planning.outcome(d.plan) !== d.outcome) problems.push(`結果が案と合わない ${planId}`);
        if (story.planResponses(planId).some((r) => r.order > d.order)) problems.push(`決定後に返事が増えた ${planId}`);
      }
    }
    // ── 章と決定の整合 ──
    const roof = story.planDecision('roof');
    const isuke3 = story.planDecision('isukeRoof');
    const ch = story.chapter;
    if ((ch === 'ch1') !== !roof) problems.push('第1幕の決定と章が合わない');
    if ((ch === 'end') !== !!isuke3) problems.push('第3幕の決定と章が合わない');
    if (isuke3 && !roof) problems.push('第1幕を決めずに第3幕を決めた');
    // ── 結果と意向・約束の整合（過去の記録や好感度から自動で承諾にならない） ──
    const fam = roof ? roof.outcome.split('-')[0] : null;
    const full = roof ? roof.outcome.endsWith('-full') : false;
    if (story.consentStatus('isuke', 'roofDay') === 'agreed' && !(fam === 'wait' || fam === 'waitHelp')) problems.push('伊助が承諾していないのに当日を承諾済み');
    if (story.consentStatus('mine', 'lendKaya') === 'agreed' && !full) problems.push('ミネが承諾していないのに茅の貸し出しが承諾済み');
    if (story.consentStatus('mine', 'coverSohei') === 'agreed' && !(fam === 'wait' || fam === 'waitHelp')) problems.push('ミネの茅刈りの代わりが承諾済み');
    if (story.consentStatus('sae', 'isukeRoofHelp') === 'agreed' && isuke3?.outcome !== 'e1') problems.push('サエの手伝いが承諾済み');
    if (story.allPromises().some((p) => p.id === 'saeReturnsKaya') !== full) problems.push('茅の返しの約束と結果が合わない');
    if (story.allPromises().some((p) => p.id === 'saeHelpsIsukeHarvest') !== (fam === 'prep')) problems.push('刈り入れの約束と結果が合わない');
    if ([...story.flagList()].some((f) => f.startsWith('kept:')) && (ch === 'ch1' || ch === 'roofDay')) problems.push('第3幕の前に約束を果たしたことになっている');
    // サエが屋根の上の仕事を承諾したことはない（足のけが）
    if (story.planResponses('isukeRoof').some((r) => r.npc === 'sae' && r.plan.saeHelp === 'roofTop' && r.status === 'agreed')) {
      problems.push('サエが屋根の上の仕事を承諾した');
    }
    // 今の案の選択肢は、知っている情報で選べるものだけ（表示される項目について）
    const planning = story.planDefs();
    const draft = story.planDraft();
    if (planning && draft && !story.planDecision()) {
      for (const item of planning.items) {
        if (item.visibleWhen && !item.visibleWhen(draft)) continue;
        const o = item.options.find((x) => x.id === draft[item.id]);
        if (!o || o.hidden || !evaluate(o.when, story)) problems.push(`知らない情報を前提とした案 ${item.id}`);
      }
    }
    return problems;
  }

  /** Game と同じ章の進め方（屋根葺きの日を終える → 三年後）。 */
  function advanceChapters(story: StoryState) {
    if (story.chapter === 'roofDay' && story.has('roofDay:ended')) {
      for (const id of PROMISES_KEPT_BY_CH3) if (story.allPromises().some((p) => p.id === id)) story.set(`kept:${id}`);
      story.setChapter('ch3');
    }
  }

  it('どの順番で回り、どこで会話をやめても、全章を通して状態に矛盾が起きず、保存・読込で同じ状態に戻る', () => {
    const rand = createRandom(20261014);
    const reached = new Set<string>();
    let cancels = 0;
    let planActions = 0;
    for (let run = 0; run < 400; run++) {
      const { story, sys } = newGame();
      for (let step = 0; step < 220; step++) {
        advanceChapters(story);
        const planId = story.activePlanId();
        const available =
          planId === 'roof' ? evaluate(PLANNING_AVAILABLE, story) : planId === 'isukeRoof' ? evaluate(knows('isuke.roof3'), story) : false;
        // 3割の確率で作業台を使う（Game と同じく、知っている情報で選べる選択肢だけを選ぶ）
        if (rand() < 0.3 && planId && available && story.planPhase() !== 'decided') {
          planActions++;
          const planning = story.planDefs()!;
          if (!story.planDraft()) story.setPlanDraft(planId === 'roof' ? INITIAL_PLAN : INITIAL_PLAN3);
          if (story.planPhase() === 'pending' && rand() < 0.7) continue;
          if (story.planPhase() === 'ready' && rand() < 0.5) {
            story.decidePlan();
            continue;
          }
          const draft = story.planDraft()!;
          const items = planning.items.filter((i) => !i.visibleWhen || i.visibleWhen(draft));
          const item = items[Math.floor(rand() * items.length)]!;
          const visible = item.options.filter((o) => !o.hidden && evaluate(o.when, story));
          const option = visible[Math.floor(rand() * visible.length)]!;
          story.setPlanDraft({ ...draft, [item.id]: option.id });
          continue;
        }
        const def = INTERACTABLES[Math.floor(rand() * INTERACTABLES.length)]!;
        sys.updateTarget({ x: def.position.x, z: def.position.z - 1, heading: 0 });
        if (!sys.interact()) continue;
        const cancelAt = rand() < 0.25 ? Math.floor(rand() * 4) : Infinity;
        for (let n = 0; sys.isActive; n++) {
          if (n > 100) throw new Error('会話が終わらない');
          if (n === cancelAt) {
            cancels++;
            sys.cancel();
            break;
          }
          const view = sys.view!;
          if (view.choices.length > 0) {
            // 案の相談・一日を終える の選択肢があれば、半分の確率でそれを選ぶ
            const key = view.choices.findIndex((c) => c.text.includes('案') || c.text.includes('一日を終える'));
            sys.choose(key >= 0 && rand() < 0.6 ? key : Math.floor(rand() * view.choices.length));
          } else sys.advance();
        }
      }
      expect(checkInvariants(story), `run ${run}`).toEqual([]);
      story.allLearned().forEach((l) => reached.add(`${l.topic}/${l.stage}`));
      for (const npc of STORY_DEFS.npcs) story.consentHistory(npc).forEach((c) => reached.add(`${npc}:${c.request}=${c.status}`));
      for (const id of ['roof', 'isukeRoof']) {
        const d = story.planDecision(id);
        if (d) reached.add(`outcome:${d.outcome}`);
        for (const r of story.planResponses(id)) reached.add(`reason:${r.npc}/${r.reason}`);
      }
      reached.add(`chapter:${story.chapter}`);

      // 保存 → 読込で同じ状態に戻る
      const text = JSON.stringify(createSave(story.snapshot(), { x: 1, z: 2, heading: 3 }));
      const parsed = parseSave(text, STORY_DEFS);
      expect(parsed.ok, `run ${run}`).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.warnings).toEqual([]);
      const restored = new StoryState(STORY_DEFS);
      restored.restore(parsed.save.story);
      expect(restored.snapshot()).toEqual(story.snapshot());
      expect(currentObjective(restored)).toBe(currentObjective(story));
    }
    // 無作為な遊び方でも、すべての章・情報の段階・結末に到達している（検査が空振りしていない）
    for (const c of ['ch1', 'roofDay', 'ch3', 'end']) expect(reached.has(`chapter:${c}`), c).toBe(true);
    const allStages = Object.values(STORY_DEFS.topics).flatMap((t) => t.stages.map((st) => `${t.id}/${st.id}`));
    expect(allStages.filter((x) => !reached.has(x))).toEqual([]);
    for (const e of ['e1', 'e2', 'e3']) expect(reached.has(`outcome:${e}`), e).toBe(true);
    const roofOutcomes = OUTCOME_IDS.filter((o) => reached.has(`outcome:${o}`));
    // ミネの茅を借りる結果（-full）は、条件を聞く→許可→控えを読む→記して借りる、と深い探索が要るため
    // 無作為では到達しにくい。8 つの結果すべてへの到達は tests/phase4.test.ts で確かめる
    expect(roofOutcomes.length, roofOutcomes.join(',')).toBeGreaterThanOrEqual(4);
    expect(cancels).toBeGreaterThan(200);
    expect(planActions).toBeGreaterThan(1000);
  });
});
