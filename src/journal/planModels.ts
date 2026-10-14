import type { CharacterDef } from '../content/characters';
import type { ForecastLine, GlanceLine, OutcomeDef, OutcomeLine } from '../content/plan';
import { evaluate } from '../story/conditions';
import type { StoryState } from '../story/StoryState';
import { CONSENT_LABEL, type ConsentStatus, type PlanId, type PlanPhase, type PlanSpec, type TopicId } from '../story/types';
import { buildTopic, type JournalSources } from './models';

/**
 * 作業台（計画）と結果画面の表示内容を、ゲーム状態と定義から組み立てる（DOM 非依存）。
 * 作業台は章ごとの計画（第1幕：サエ家の屋根葺き／第3幕：伊助家の屋根葺き）に対応する。
 *
 * 情報の段階（docs/PHASE3_5_IMPROVEMENT.md「B」）：
 * 1. 見込み・返事・承諾を得た案（判断の中心）
 * 2. この案に関わる事情（今の案の選択肢に関係する情報だけ）
 * 3. 以前の案への返事（開閉式）
 */

export interface PlanOptionView {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly selected: boolean;
}

export interface PlanItemView {
  readonly id: string;
  readonly label: string;
  readonly options: readonly PlanOptionView[];
  /** まだ思いついていない（情報が足りず表示しない）選択肢の数。 */
  readonly hidden: number;
}

export type ResponseState = ConsentStatus | 'unasked';

export interface PlanResponseView {
  readonly npc: string;
  readonly name: string;
  readonly state: ResponseState;
  readonly label: string;
  readonly summary?: string;
}

export interface PastResponseView {
  readonly plan: string;
  readonly name: string;
  readonly label: string;
  readonly summary?: string;
}

export interface AgreedPlanView {
  readonly key: string;
  readonly plan: PlanSpec;
  readonly label: string;
  readonly current: boolean;
  readonly forecast: readonly ForecastLine[];
  /** 要点（見比べ用。Phase 6）。 */
  readonly glance: readonly GlanceLine[];
}

export interface ConsiderationView {
  readonly title: string;
  readonly summary: string;
  readonly text: string;
}

export interface PlanBoardModel {
  readonly title: string;
  readonly phase: PlanPhase;
  readonly decided: boolean;
  readonly outcomeTitle?: string;
  readonly items: readonly PlanItemView[];
  readonly invalidReason: string | null;
  /** 今の案の要点（いつ・どこまで・加わる人・負担・約束）。 */
  readonly glance: readonly GlanceLine[];
  readonly forecast: readonly ForecastLine[];
  readonly responses: readonly PlanResponseView[];
  readonly agreed: readonly AgreedPlanView[];
  readonly past: readonly PastResponseView[];
  readonly considerations: readonly ConsiderationView[];
  readonly canDecide: boolean;
}

export const RESPONSE_LABEL: Record<ResponseState, string> = {
  unasked: 'まだ相談していない',
  agreed: CONSENT_LABEL.agreed,
  conditional: CONSENT_LABEL.conditional,
  declined: CONSENT_LABEL.declined,
};

/** 計画ごとの表示用の定義（content/plan.ts・plan3.ts）。 */
export interface PlanUiDefs {
  readonly summaries: Readonly<Record<string, string>>;
  readonly forecast: (plan: PlanSpec, story: StoryState) => ForecastLine[];
  readonly glance: (plan: PlanSpec, story: StoryState) => GlanceLine[];
  readonly relevantTopics: Readonly<Record<string, Readonly<Record<string, readonly TopicId[]>>>>;
  /** 結果の見出し・一行の要約（作業台の「決めた」表示や「選ばなかった案」に使う）。 */
  readonly outcomeTitle: (id: string) => string | undefined;
  readonly outcomeTagline: (id: string) => string | undefined;
}

export interface PlanSources extends JournalSources {
  readonly plans: Readonly<Record<PlanId, PlanUiDefs>>;
}

/** 案を短い文で表す（作業台に出ている項目だけ）。 */
export function describePlan(story: StoryState, plan: PlanSpec, planId: PlanId | null = story.activePlanId()): string {
  const items = story.planDefs(planId)?.items ?? [];
  return items
    .filter((i) => !i.visibleWhen || i.visibleWhen(plan))
    .map((i) => i.options.find((o) => o.id === plan[i.id])?.label ?? '?')
    .join('／');
}

export function buildPlanBoard(story: StoryState, src: PlanSources): PlanBoardModel {
  const planning = story.planDefs();
  if (!planning) throw new Error('この章には計画がありません');
  const ui = src.plans[planning.id];
  if (!ui) throw new Error(`計画 ${planning.id} の表示定義がありません`);
  const draft = story.planDraft();
  const decision = story.planDecision();
  const nameOf = (npc: string) => (src.characters[npc] as CharacterDef | undefined)?.name ?? npc;
  const sigOf = (p: PlanSpec) => story.planSignature(p);

  const items = planning.items
    .filter((item) => !draft || !item.visibleWhen || item.visibleWhen(draft))
    .map((item) => {
      const shown = item.options.filter((o) => !o.hidden);
      // 選んでいる選択肢は常に出す。それ以外は条件（知っている情報）を満たすものだけ
      const visible = shown.filter((o) => draft?.[item.id] === o.id || evaluate(o.when, story));
      return {
        id: item.id,
        label: item.label,
        options: visible.map((o) => ({
          id: o.id,
          label: o.label,
          ...(o.detail ? { detail: o.detail } : {}),
          selected: draft?.[item.id] === o.id,
        })),
        hidden: shown.length - visible.length,
      };
    });

  const responses: PlanResponseView[] = story.planInvolved().map((npc) => {
    const r = story.planResponse(npc);
    const state: ResponseState = r?.status ?? 'unasked';
    const summary = r ? ui.summaries[r.reason] : undefined;
    return { npc, name: nameOf(npc), state, label: RESPONSE_LABEL[state], ...(summary ? { summary } : {}) };
  });

  const current = draft ? sigOf(draft) : '';
  const agreed = story.agreedPlans().map((plan) => ({
    key: sigOf(plan),
    plan,
    label: describePlan(story, plan),
    current: sigOf(plan) === current,
    forecast: ui.forecast(plan, story),
    glance: ui.glance(plan, story),
  }));

  const past = story
    .planResponses()
    .filter((r) => sigOf(r.plan) !== current)
    .slice()
    .reverse()
    .map((r) => {
      const summary = ui.summaries[r.reason];
      return { plan: describePlan(story, r.plan), name: nameOf(r.npc), label: RESPONSE_LABEL[r.status], ...(summary ? { summary } : {}) };
    });

  const topicIds = new Set<TopicId>();
  if (draft) {
    for (const item of planning.items) {
      if (item.visibleWhen && !item.visibleWhen(draft)) continue;
      for (const t of ui.relevantTopics[item.id]?.[draft[item.id] ?? ''] ?? []) topicIds.add(t);
    }
  }
  const considerations = [...topicIds]
    .map((t) => buildTopic(story, t, src))
    .filter((t) => t !== null)
    .map((t) => ({ title: t.personName ? `${t.personName}｜${t.title}` : t.title, summary: t.summary, text: t.text }));

  const outcomeTitle = decision ? ui.outcomeTitle(decision.outcome) : undefined;
  return {
    title: planning.title,
    phase: story.planPhase(),
    decided: decision !== null,
    ...(outcomeTitle ? { outcomeTitle } : {}),
    items,
    invalidReason: draft ? planning.invalidReason(draft) : null,
    glance: draft ? ui.glance(draft, story) : [],
    forecast: draft ? ui.forecast(draft, story) : [],
    responses,
    agreed,
    past,
    considerations,
    canDecide: story.planPhase() === 'ready',
  };
}

// ───────── 結果（第1幕） ─────────

export interface OutcomeView {
  readonly title: string;
  readonly when: string;
  readonly decided: { readonly plan: string; readonly agreedBy: string };
  readonly story: readonly string[];
  readonly achieved: readonly string[];
  readonly costs: readonly string[];
  readonly notChosen: ReadonlyArray<{ readonly plan: string; readonly tagline: string }>;
}

export const shownLines = (story: StoryState, lines: readonly OutcomeLine[]): string[] =>
  lines.filter((l) => evaluate(l.when, story)).map((l) => l.text);

/** 第1幕で決めた計画の結果。知っていた情報によって文章が変わる。 */
export function buildOutcome(
  story: StoryState,
  outcomes: Readonly<Record<string, OutcomeDef>>,
  src?: JournalSources,
  planId: PlanId = 'roof',
): OutcomeView | null {
  const decision = story.planDecision(planId);
  const def = decision ? outcomes[decision.outcome] : undefined;
  const planning = story.planDefs(planId);
  if (!decision || !def || !planning) return null;
  const nameOf = (npc: string) => (src?.characters[npc] as CharacterDef | undefined)?.name ?? npc;
  const sig = story.planSignature(decision.plan, planId);
  const notChosen = story
    .agreedPlans(planId)
    .filter((p) => story.planSignature(p, planId) !== sig)
    .map((p) => {
      const id = planning.outcome(p);
      return { plan: describePlan(story, p, planId), tagline: (id && outcomes[id]?.tagline) || '' };
    });
  return {
    title: def.title,
    when: def.when,
    decided: {
      plan: describePlan(story, decision.plan, planId),
      agreedBy: planning.involved(decision.plan).map(nameOf).join('・'),
    },
    story: shownLines(story, def.story),
    achieved: shownLines(story, def.achieved),
    costs: shownLines(story, def.costs),
    notChosen,
  };
}

// ───────── 新しく考えられるようになった案（重要な発見の意味を伝える。Phase 6） ─────────

/**
 * 今の章の作業台で、情報を知ったことで選べるようになった選択肢の一覧（`項目:選択肢`）。
 * 発見の前後で比べ、増えたら「作業台で考えられる案が増えた」と伝える（どの案かは作業台で確かめる）。
 */
export function unlockedOptions(story: StoryState): Set<string> {
  const planning = story.planDefs();
  const keys = new Set<string>();
  if (!planning) return keys;
  for (const item of planning.items) {
    for (const o of item.options) if (o.when && !o.hidden && evaluate(o.when, story)) keys.add(`${planning.id}:${item.id}:${o.id}`);
  }
  return keys;
}
