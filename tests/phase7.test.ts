import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { DIALOGUES, PLAN_SUMMARY } from '../src/content/dialogues';
import { INTERACTABLES } from '../src/content/interactables';
import { LEDGER } from '../src/content/ledger';
import { ledgerEntries } from '../src/content/chronicle';
import { OBJECTIVES, currentObjective, currentObjectiveDetail } from '../src/content/objectives';
import { forecastPlan, glancePlan, planSentence } from '../src/content/plan';
import { planSentence3 } from '../src/content/plan3';
import { STORY_DEFS } from '../src/content/story';
import { SAE_HOUSE_OPEN } from '../src/content/house';
import { NoticeQueue } from '../src/game/noticeQueue';
import type { GameEvents } from '../src/game/events';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { promptState } from '../src/interaction/types';
import { evaluate } from '../src/story/conditions';
import { StoryState } from '../src/story/StoryState';
import type { PlanSpec } from '../src/story/types';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, PLAYER_START, PROPS, TREES, WALK_BOUNDS } from '../src/world/layout';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 7 の初回改善（docs/PHASE7_PLAN.md）：第三者プレイテストの指摘のうち、通常のプレイでも問題になるもの。
 * 会話と通知の順序（U03）、未確認情報の文言（U04）、案の要約（U05）、入口の表示（U06）、結帳の記号（U09）、
 * 目的の短い表現（H02）、屋根を調べる場所（U02）。
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

// ───────── U03：会話と通知の順序 ─────────

describe('会話中の通知は、結果を伝える場面を読み終えてから出す（U03）', () => {
  it('間の場面（分岐するだけ）では出さず、その次の内容の場面を離れたときに出す', () => {
    const q = new NoticeQueue();
    q.begin();
    expect(q.nodeChanged(false).notices).toHaveLength(0); // 最初の場面を表示
    q.push({ label: '相談', text: '承諾' }); // 選択肢を選んだ瞬間に状態が変わる
    expect(q.nodeChanged(true).notices).toHaveLength(0); // 間の場面（「しばらく案を見つめていた」）を表示。まだ出さない
    expect(q.nodeChanged(false).notices).toHaveLength(0); // 間の場面を離れて返事の場面へ（間の場面なので出さない）
    const out = q.nodeChanged(true); // 返事の場面を読み終えて次へ
    expect(out.notices.map((n) => n.text)).toEqual(['承諾']);
    expect(q.end().notices).toHaveLength(0); // 二重に出さない
  });

  it('会話が終わったら残りをすべて出す（出し漏れがない）。会話中でなければすぐ出す', () => {
    const q = new NoticeQueue();
    expect(q.push({ label: 'a', text: 'a' })).toBe(false);
    q.begin();
    q.push({ label: 'b', text: 'b' });
    q.push({ label: 'c', text: 'c' });
    expect(q.end().notices.map((n) => n.text)).toEqual(['b', 'c']);
    expect(q.active).toBe(false);
  });

  it('目的表示の更新は、溜めた通知がすべて出るまで待つ（後で出す結果が目的から先に分からない）', () => {
    const q = new NoticeQueue();
    q.begin();
    q.nodeChanged(false);
    q.push({ label: '手帳に記録', text: '前の場面で分かったこと' });
    q.deferRefresh();
    q.nodeChanged(true); // 次の場面へ
    q.push({ label: '相談', text: '承諾' }); // この場面で選んだ
    const early = q.nodeChanged(true); // 前の場面の分だけ出す
    expect(early.notices.map((n) => n.text)).toEqual(['前の場面で分かったこと']);
    expect(early.refresh).toBe(false);
    expect(q.end()).toEqual({ notices: [{ label: '相談', text: '承諾' }], refresh: true });
  });

  /** Game と同じ手順で会話を進め、通知が出る時点を記録する（速い送りでも順序が変わらない）。 */
  function runConsult(npc: 'sae' | 'sohei') {
    const events = new EventBus<GameEvents>();
    const story = new StoryState(STORY_DEFS, events);
    for (const [t, s] of [
      ['sae.schedule', 'needsHelp'],
      ['sae.kaya', 'short'],
    ] as const)
      story.learn(t, s);
    story.markMet('sae');
    story.markMet('sohei');
    story.set('talked:sae');
    story.set('talked:sohei');
    story.setPlanDraft(PLANS['solo-part']!);
    const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story, events);
    const q = new NoticeQueue();
    const shown: Array<{ text: string; whileShowing: string }> = [];
    let current = '';
    events.on('planResponded', ({ status }) => {
      if (!q.push({ label: '相談', text: status })) shown.push({ text: status, whileShowing: current });
    });
    const def = sys.interactables.find((i) => i.id === npc)!;
    sys.updateTarget({ x: def.position.x, z: def.position.z - 1, heading: 0 });
    q.begin();
    sys.interact();
    let lastNode = '';
    const flush = (out: ReturnType<typeof q.end>) => out.notices.forEach((n) => shown.push({ text: n.text, whileShowing: current }));
    for (let guard = 0; sys.isActive && guard < 60; guard++) {
      const view = sys.view!;
      const key = `${view.scriptId}:${view.nodeId}`;
      if (key !== lastNode) {
        const [s, n] = lastNode.split(':');
        const prev = s && n ? DIALOGUES[s]?.nodes[n] : undefined;
        current = key;
        flush(q.nodeChanged(prev !== undefined && !prev.branches?.length));
        lastNode = key;
      }
      current = key;
      if (view.choices.length > 0) {
        const i = view.choices.findIndex((c) => /作業台でまとめた案|この案|この段取り/.test(c.text));
        sys.choose(i >= 0 ? i : view.choices.length - 1);
      } else sys.advance();
    }
    current = 'ended';
    flush(q.end());
    return shown;
  }

  it.each(['sae', 'sohei'] as const)('%s に案を相談すると、返事の通知は「考えている」場面より後に出る', (npc) => {
    const shown = runConsult(npc);
    expect(shown).toHaveLength(1);
    // 「しばらく案を見つめていた」「紙をじっと見ている」の場面（planReact）を表示している間には出ない
    expect(shown[0]!.whileShowing).not.toMatch(/planReact$/);
    expect(shown[0]!.whileShowing).not.toMatch(/planConsult$/);
  });
});

// ───────── U04：未確認情報の文言 ─────────

describe('未確認の情報を、知っている状態に合わせて書き分ける（U04）', () => {
  const keepDayOf: PlanSpec = { date: 'keep', isuke: 'dayOf', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' };
  const text = (s: StoryState) => forecastPlan(keepDayOf, s).find((l) => l.aspect === '伊助')!.text;
  const glance = (s: StoryState, key: string) => glancePlan(keepDayOf, s).find((g) => g.key === key)!;

  it('伊助に都合を聞いていないときは「断られた」と書かない。聞いて断られたが理由を知らないとき・理由を知っているときで書き分ける', () => {
    const none = new StoryState(STORY_DEFS);
    expect(text(none)).not.toContain('断られた');
    expect(text(none)).toContain('都合を聞いていない');
    expect(glance(none, 'who').text).toContain('伊助（都合をまだ聞いていない）');
    const declined = new StoryState(STORY_DEFS);
    declined.learn('isuke.availability', 'declined');
    expect(text(declined)).toContain('断られた理由をまだ知らない');
    expect(glance(declined, 'who').text).toContain('伊助（来られるか分からない）');
    const known = new StoryState(STORY_DEFS);
    known.learn('isuke.availability', 'declined');
    known.learn('isuke.availability', 'harvest');
    expect(text(known)).toContain('刈り入れと重なる');
    expect(glance(known, 'who').uncertain).toBe(false);
  });

  it('負担の欄：事情が分からない人がいるときは「特に重くなる人はいない」と言わず「まだ判断できない」とする', () => {
    const none = new StoryState(STORY_DEFS);
    const b = glance(none, 'burden');
    expect(b.text).toContain('まだ判断できない');
    expect(b.uncertain).toBe(true);
    // 事情が分かっていて、本当に負担が増えない案では「特に重くなる人はいない」
    const known = new StoryState(STORY_DEFS);
    known.learn('isuke.availability', 'declined');
    known.learn('isuke.availability', 'harvest');
    const kb = glancePlan({ ...keepDayOf, isuke: 'dayOf' }, known).find((g) => g.key === 'burden')!;
    expect(kb.text).toBe('特に重くなる人はいない');
    expect(kb.uncertain).toBe(false);
  });

  it('未発見の情報（刈り入れ・宗平の茅刈り）は、知るまで要点・見込みに出ない', () => {
    const none = new StoryState(STORY_DEFS);
    for (const p of Object.values(PLANS)) {
      const all = [...glancePlan(p, none).map((g) => g.text), ...forecastPlan(p, none).map((l) => l.text)].join('\n');
      expect(all, JSON.stringify(p)).not.toContain('刈り入れと重なる');
      expect(all, JSON.stringify(p)).not.toContain('茅刈りを仕切っていて');
    }
  });
});

// ───────── U05：案の要約 ─────────

describe('相談・決定の直前の案の要約（U05）', () => {
  it('8 つの案の要約はそれぞれ違い、いつ・伊助に何を頼むか・茅・屋根のどこまでが分かる', () => {
    const texts = Object.values(PLANS).map(planSentence);
    expect(new Set(texts).size).toBe(8);
    for (const t of texts) {
      expect(t).toMatch(/予定日|刈り入れの後/);
      expect(t).toMatch(/伊助/);
      expect(t).toMatch(/茅/);
      expect(t).toMatch(/南面をすべて|傷みのひどい所だけ/);
      expect(t).not.toMatch(/頼まない／|／なし/); // 単なる項目の羅列ではない
    }
    expect(planSentence(PLANS['prep-full']!)).toContain('伊助家の刈り入れに人を出す');
    expect(planSentence(PLANS['wait-full']!)).toContain('茅刈りの段取りは、ミネに頼む');
  });

  it('第3幕の要約も、案ごとに違う', () => {
    const t = [
      planSentence3({ timing: 'now', saeHelp: 'roofTop' }),
      planSentence3({ timing: 'now', saeHelp: 'ground' }),
      planSentence3({ timing: 'now', saeHelp: 'none' }),
      planSentence3({ timing: 'nextYear', saeHelp: 'none' }),
    ];
    expect(new Set(t).size).toBe(4);
  });

  it('相談の会話には、要約を出すページがある（相談の選択肢の直前）', () => {
    for (const [id, script] of Object.entries(DIALOGUES)) {
      for (const [nodeId, node] of Object.entries(script.nodes)) {
        if (!nodeId.startsWith('planConsult')) continue;
        expect(node.lines[node.lines.length - 1], `${id}.${nodeId}`).toBe(PLAN_SUMMARY);
      }
    }
  });
});

// ───────── U06：入口の表示 ─────────

describe('サエ家の入口の表示は、入れるかどうかと一致する（U06）', () => {
  const door = INTERACTABLES.find((i) => i.id === 'saeDoor')!;
  const inside = INTERACTABLES.find((i) => i.id === 'saeDoorInside')!;

  it('許しがない間は「調べる」、許しがあれば「入る」。出入口には「済」を付けない', () => {
    expect(promptState(door, true, false)).toEqual({ action: '調べる', done: false });
    expect(promptState(door, true, true)).toEqual({ action: '入る', done: false });
    expect(promptState(inside, true, true)).toEqual({ action: '外に出る', done: false });
    // ほかの調べる物・住民は従来どおり（調べ終えたら「済」）
    const roof = INTERACTABLES.find((i) => i.id === 'saeRoof')!;
    expect(promptState(roof, true, false)).toEqual({ action: '調べる', done: true });
  });

  it('許しの状態は物語の状態（サエに頼んだか・結帳を読んだか）で決まる', () => {
    const s = new StoryState(STORY_DEFS);
    expect(evaluate(SAE_HOUSE_OPEN, s)).toBe(false);
    s.set('asked:saeLedger');
    expect(evaluate(SAE_HOUSE_OPEN, s)).toBe(true);
  });
});

// ───────── U09：結帳の記号 ─────────

describe('プレイヤー向けの文章に内部の記号（L1・L2 など）を出さない（U09）', () => {
  it('結帳の記載（全章の記録）と会話に、記録の ID が出ない', () => {
    const s = new StoryState(STORY_DEFS);
    const texts = [
      ...LEDGER.flatMap((e) => [e.when, e.title, ...e.items.flatMap((i) => [i.detail, i.settlementNote])]),
      ...ledgerEntries(s).flatMap((e) => e.items.map((i) => i.settlementNote)),
      ...Object.values(DIALOGUES).flatMap((d) => Object.values(d.nodes).flatMap((n) => [...n.lines, ...(n.choices ?? []).map((c) => c.text)])),
    ];
    for (const t of texts) expect(t).not.toMatch(/\bL\d\b|（L\d）/);
  });
});

// ───────── H02：目的の短い表現 ─────────

describe('右上の目的は短く、補足はポーズ画面へ（H02）', () => {
  it('目的の文は 32 字以内（長い補足は detail に分ける）', () => {
    for (const o of OBJECTIVES) expect(o.text.length, o.text).toBeLessThanOrEqual(32);
  });

  it('全員が承知したときの目的は短く、決めると変えられないことは補足に出る', () => {
    const s = new StoryState(STORY_DEFS);
    s.learn('sae.schedule', 'needsHelp');
    s.learn('sae.kaya', 'short');
    for (const f of ['talked:toki', 'talked:sae', 'talked:isuke', 'talked:sohei', 'talked:mine']) s.set(f);
    s.setPlanDraft(PLANS['solo-part']!);
    for (const npc of s.planInvolved()) s.consultPlan(npc);
    expect(currentObjective(s)).toBe('全員が承知した。作業台で計画を決める');
    expect(currentObjectiveDetail(s)).toContain('変えられない');
  });
});

// ───────── U02：屋根を調べる場所 ─────────

describe('屋根を調べる場所（U02）', () => {
  it('広場から家の西側へ近づけば、真下まで行かなくても調べられる距離に入る', () => {
    const roof = INTERACTABLES.find((i) => i.id === 'saeRoof')!;
    const colliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
    const map = buildReachability(colliders, WALK_BOUNDS, PLAYER_START.position, DEFAULT_PLAYER_TUNING.radius);
    // 広場の西寄り（石灯籠の前）から届く
    expect(Math.hypot(-2.5 - roof.position.x, 12.8 - roof.position.z)).toBeLessThan(roof.range);
    expect(map.nearestReachable({ x: -2.5, z: 12.8 })).toBeLessThan(0.4);
    // 入口・サエの前では、入口・サエより遠い（取り違えない）
    const door = INTERACTABLES.find((i) => i.id === 'saeDoor')!;
    expect(Math.hypot(door.position.x - roof.position.x, door.position.z - roof.position.z)).toBeGreaterThan(roof.range);
  });
});
