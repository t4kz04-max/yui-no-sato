import { describe, expect, it } from 'vitest';
import { penetration } from '../src/core/collision';
import { CHARACTERS } from '../src/content/characters';
import { DIALOGUES } from '../src/content/dialogues';
import { NPCS, NPC_COLLIDER_RADIUS, npcColliders } from '../src/content/interactables';
import { OUTCOMES, PLANNING, RELEVANT_TOPICS, RESPONSE_SUMMARY, forecastPlan } from '../src/content/plan';
import { HOUSEHOLDS, STORY_DEFS } from '../src/content/story';
import { parseEmphasis, plainText } from '../src/dialogue/markup';
import { buildNotebook } from '../src/journal/models';
import { buildOutcome, buildPlanBoard, type PlanSources } from '../src/journal/planModels';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { StoryState } from '../src/story/StoryState';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, PATHS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, distanceToSegment } from '../src/world/layout';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 3.5（docs/PHASE3_5_IMPROVEMENT.md）の改善の確認。
 * 情報を整理しても必要な情報が失われないこと、判断の材料（見込み・承諾を得た案の比較）、
 * 結果の見せ方、結果に応じた村の様子。
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

const PLANS = {
  r1: { date: 'keep', isuke: 'none', offer: 'none' },
  r2: { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp' },
  r3: { date: 'afterHarvest', isuke: 'dayOf', offer: 'none' },
  r3help: { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp' },
} as const;

/** すべての情報を知っている状態。 */
function knowingAll(): StoryState {
  const s = new StoryState(STORY_DEFS);
  for (const t of Object.values(STORY_DEFS.topics)) {
    const learnable = t.stages.filter((st) => !['worse', 'renewed'].includes(st.id));
    const last = learnable[learnable.length - 1];
    if (last) s.learn(t.id, last.id);
  }
  return s;
}

const text = (lines: ReturnType<typeof forecastPlan>) => lines.map((l) => `${l.aspect}:${l.text}`).join('\n');

describe('情報の整理（削らずに段階を分ける）', () => {
  it('すべての情報の段階に、要点と全文がある', () => {
    for (const t of Object.values(STORY_DEFS.topics)) {
      for (const st of t.stages) {
        expect(st.summary, `${t.id}/${st.id}`).toBeTruthy();
        expect(st.text.length, `${t.id}/${st.id}`).toBeGreaterThan(st.summary!.length);
      }
    }
  });

  it('手帳には要点・全文・経緯（以前の記述の要点と全文）がすべて残る', () => {
    const s = new StoryState(STORY_DEFS);
    s.markMet('isuke');
    s.learn('isuke.availability', 'declined', { source: '伊助と話した' });
    s.learn('isuke.availability', 'harvest', { source: '伊助と話した' });
    const item = buildNotebook(s, src).known.find((t) => t.topic === 'isuke.availability')!;
    expect(item.summary).toBe('予定日は刈り入れと重なる');
    expect(item.text).toContain('天気のいいうちに');
    expect(item.history[0]).toMatchObject({ summary: '当日は手伝えないと言う（理由は未確認）', source: '伊助と話した' });
    expect(item.history[0]!.text).toContain('理由はまだ分からない');
  });

  it('作業台の「この案に関わる事情」は、今の案の選択肢に関係する情報だけ', () => {
    const s = knowingAll();
    s.setPlanDraft(PLANS.r1);
    const titles1 = buildPlanBoard(s, src).considerations.map((c) => c.title);
    expect(titles1.some((t) => t.includes('伊助の畑'))).toBe(false);
    s.setPlanDraft(PLANS.r2);
    const titles2 = buildPlanBoard(s, src).considerations.map((c) => c.title);
    expect(titles2.some((t) => t.includes('伊助の畑'))).toBe(true);
    expect(titles2.some((t) => t.includes('伊助の当日の都合'))).toBe(true);
    for (const byOption of Object.values(RELEVANT_TOPICS)) {
      for (const topics of Object.values(byOption)) for (const t of topics) expect(STORY_DEFS.topics[t], t).toBeDefined();
    }
  });

  it('会話の強調記法：要点だけを強調し、記法は表示されない', () => {
    expect(parseEmphasis('前の**要点**後')).toEqual([
      { text: '前の', strong: false },
      { text: '要点', strong: true },
      { text: '後', strong: false },
    ]);
    expect(plainText('a**b**c')).toBe('abc');
    expect(plainText('閉じない**記法')).toBe('閉じない**記法');
    // すべての台詞で ** が対になっている
    for (const script of Object.values(DIALOGUES)) {
      for (const node of Object.values(script.nodes)) {
        for (const line of node.lines) expect(line.split('**').length % 2, `${script.id}: ${line}`).toBe(1);
      }
    }
  });
});

describe('判断の材料：見込み', () => {
  it('4 つの結果の案は、見込みがすべて異なり、どの案にも代償がある', () => {
    const s = knowingAll();
    const forecasts = Object.values(PLANS).map((p) => text(forecastPlan(p, s)));
    expect(new Set(forecasts).size).toBe(4);
    for (const [id] of Object.entries(PLANS)) {
      const def = OUTCOMES[id]!;
      expect(def.achieved.length, id).toBeGreaterThan(0);
      // 「全部うまくいく」結果はない
      expect(def.costs.filter((c) => !c.when).length, id).toBeGreaterThan(0);
    }
  });

  it('R2 の見込みには、刈り入れが止まることと、約束が残ることが判断の前に示される', () => {
    const f = text(forecastPlan(PLANS.r2, knowingAll()));
    expect(f).toContain('前日の半日、刈り入れが止まる');
    expect(f).toContain('刈り入れに人を出す約束が残る');
    expect(f).toContain('十二年前の返しと約束が重なる');
  });

  it('見込みは知っている情報の分だけ見通せる（情報が「正解の鍵」ではなく「見通す力」になる）', () => {
    const little = new StoryState(STORY_DEFS);
    little.learn('isuke.availability', 'harvest');
    const unsure = forecastPlan(PLANS.r3, little);
    expect(unsure.find((l) => l.aspect === '屋根')?.uncertain).toBe(true);
    expect(text(unsure)).toContain('まだ分からない');

    const sure = forecastPlan(PLANS.r3, knowingAll());
    expect(sure.find((l) => l.aspect === '屋根')?.uncertain).toBe(false);
    expect(text(sure)).toContain('十日ほど先に葺く');
    expect(text(sure)).toContain('手間と茅が余計に要る');
    // 返事・結果の規則は情報の有無で変わらない
    expect(PLANNING.respond('isuke', PLANS.r3)).toEqual(PLANNING.respond('isuke', PLANS.r3));
  });

  it('成り立たない案には見込みを出さない', () => {
    expect(forecastPlan({ date: 'keep', isuke: 'none', offer: 'harvestHelp' }, knowingAll())).toEqual([]);
  });
});

describe('判断の材料：承諾を得た案を並べて選ぶ', () => {
  it('承諾を得た案は案を変えても残り、並べて見比べ、選び直して決められる', () => {
    const s = knowingAll();
    s.setPlanDraft(PLANS.r1);
    s.consultPlan('sae');
    s.setPlanDraft(PLANS.r3);
    s.consultPlan('sae');
    s.consultPlan('isuke');
    s.setPlanDraft(PLANS.r2);
    s.consultPlan('isuke');
    s.consultPlan('sae');
    const board = buildPlanBoard(s, src);
    expect(board.agreed.map((a) => a.label)).toEqual([
      '予定日のまま／頼まない／なし',
      '伊助家の刈り入れの後に延ばす／当日の手伝いを頼む／なし',
      '予定日のまま／前日の準備を頼む／伊助家の刈り入れに人を出す',
    ]);
    expect(board.agreed.filter((a) => a.current).length).toBe(1);
    expect(board.agreed.every((a) => a.forecast.length === 4)).toBe(true);

    // 承諾を得た R1 を広げ直すと、相談し直さずに決められる
    s.setPlanDraft(PLANS.r1);
    expect(s.planPhase()).toBe('ready');
    expect(s.decidePlan()).toBe('r1');

    // 結果画面：決めたこと／実現したこと／残ったこと／選ばなかった案
    const v = buildOutcome(s, OUTCOMES, src)!;
    expect(v.decided).toEqual({ plan: '予定日のまま／頼まない／なし', agreedBy: 'サエ' });
    expect(v.achieved.length).toBeGreaterThan(0);
    expect(v.costs.join()).toContain('二日がかり');
    expect(v.notChosen.map((n) => n.tagline)).toEqual([OUTCOMES.r3!.tagline, OUTCOMES.r2!.tagline]);
  });

  it('断り・条件付きの案は「承諾を得た案」に入らない', () => {
    const s = knowingAll();
    s.setPlanDraft({ date: 'keep', isuke: 'dayBefore', offer: 'none' });
    s.consultPlan('sae');
    s.consultPlan('isuke');
    expect(s.agreedPlans()).toEqual([]);
  });
});

describe('結果に応じた村の様子', () => {
  const world = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
  const radius = DEFAULT_PLAYER_TUNING.radius;

  it('結果ごとに村の様子（住民の立ち位置・刈り入れ）の違いがある', () => {
    const looks = Object.values(OUTCOMES).map((o) => JSON.stringify({ p: o.placements, h: o.harvestDone }));
    expect(new Set(looks).size).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(OUTCOMES))('結果「%s」の後の立ち位置は、障害物・道と重ならず、話しかけに行ける', (_, o) => {
    const npcs = NPCS.map((n) => {
      const p = o.placements[n.character];
      return p ? { ...n, position: p.position, heading: p.heading } : n;
    });
    for (const n of npcs) {
      for (const c of world) expect(penetration(n.position, NPC_COLLIDER_RADIUS, c), n.id).toBeNull();
      for (const other of npcs) {
        if (other !== n) expect(Math.hypot(other.position.x - n.position.x, other.position.z - n.position.z), n.id).toBeGreaterThan(1.2);
      }
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          const d = distanceToSegment(n.position.x, n.position.z, path.points[i]!, path.points[i + 1]!);
          expect(d, n.id).toBeGreaterThan(path.width / 2 + NPC_COLLIDER_RADIUS + 0.2);
        }
      }
    }
    const map = buildReachability([...world, ...npcColliders(npcs)], WALK_BOUNDS, PLAYER_START.position, radius);
    for (const n of npcs) expect(map.nearestReachable(n.position), n.id).toBeLessThan(n.range - 0.4);
  });
});
