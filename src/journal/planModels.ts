import type { CharacterDef } from '../content/characters';
import type { ForecastLine, OutcomeDef } from '../content/plan';
import { evaluate } from '../story/conditions';
import type { StoryState } from '../story/StoryState';
import { CONSENT_LABEL, type ConsentStatus, type PlanPhase, type PlanSpec, type TopicId } from '../story/types';
import { buildTopic, type JournalSources } from './models';

/**
 * 作業台（計画）と結果画面の表示内容を、ゲーム状態と定義から組み立てる（DOM 非依存）。
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
}

export interface ConsiderationView {
  readonly title: string;
  /** 要点（一句）。 */
  readonly summary: string;
  /** 全文。 */
  readonly text: string;
}

export interface PlanBoardModel {
  readonly phase: PlanPhase;
  readonly decided: boolean;
  readonly outcomeTitle?: string;
  readonly items: readonly PlanItemView[];
  readonly invalidReason: string | null;
  /** この案で起きることの見込み（知っている情報の分だけ見通せる）。 */
  readonly forecast: readonly ForecastLine[];
  /** 今の案に返事が必要な人と、その返事。 */
  readonly responses: readonly PlanResponseView[];
  /** 関係者全員の承諾を得た案（見比べて、どれを決めるか選ぶ）。 */
  readonly agreed: readonly AgreedPlanView[];
  /** 以前の案への返事（新しい順）。 */
  readonly past: readonly PastResponseView[];
  /** 今の案の選択肢に関わる、手帳で知っている事情。 */
  readonly considerations: readonly ConsiderationView[];
  readonly canDecide: boolean;
}

export const RESPONSE_LABEL: Record<ResponseState, string> = {
  unasked: 'まだ相談していない',
  agreed: CONSENT_LABEL.agreed,
  conditional: CONSENT_LABEL.conditional,
  declined: CONSENT_LABEL.declined,
};

export interface PlanSources extends JournalSources {
  readonly summaries: Readonly<Record<string, string>>;
  readonly outcomes: Readonly<Record<string, OutcomeDef>>;
  /** 案の見込み（content/plan.ts の forecastPlan）。 */
  readonly forecast: (plan: PlanSpec, story: StoryState) => ForecastLine[];
  /** 選択肢ごとに関係する情報（項目 ID → 選択肢 ID → 情報 ID）。 */
  readonly relevantTopics: Readonly<Record<string, Readonly<Record<string, readonly TopicId[]>>>>;
}

/** 案を短い文で表す（例：「予定日のまま／前日の準備を頼む／伊助家の刈り入れに人を出す」）。 */
export function describePlan(story: StoryState, plan: PlanSpec): string {
  const items = story.defs.planning?.items ?? [];
  return items.map((i) => i.options.find((o) => o.id === plan[i.id])?.label ?? '?').join('／');
}

export function buildPlanBoard(story: StoryState, src: PlanSources): PlanBoardModel {
  const planning = story.defs.planning;
  if (!planning) throw new Error('計画の定義がありません');
  const draft = story.planDraft();
  const decision = story.planDecision();
  const nameOf = (npc: string) => (src.characters[npc] as CharacterDef | undefined)?.name ?? npc;
  const sigOf = (p: PlanSpec) => story.planSignature(p);

  const items = planning.items.map((item) => {
    // 選んでいる選択肢は常に出す。それ以外は条件（知っている情報）を満たすものだけ
    const visible = item.options.filter((o) => draft?.[item.id] === o.id || evaluate(o.when, story));
    return {
      id: item.id,
      label: item.label,
      options: visible.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.detail ? { detail: o.detail } : {}),
        selected: draft?.[item.id] === o.id,
      })),
      hidden: item.options.length - visible.length,
    };
  });

  const responses: PlanResponseView[] = story.planInvolved().map((npc) => {
    const r = story.planResponse(npc);
    const state: ResponseState = r?.status ?? 'unasked';
    const summary = r ? src.summaries[r.reason] : undefined;
    return { npc, name: nameOf(npc), state, label: RESPONSE_LABEL[state], ...(summary ? { summary } : {}) };
  });

  const current = draft ? sigOf(draft) : '';
  const agreed = story.agreedPlans().map((plan) => ({
    key: sigOf(plan),
    plan,
    label: describePlan(story, plan),
    current: sigOf(plan) === current,
    forecast: src.forecast(plan, story),
  }));

  const past = story
    .planResponses()
    .filter((r) => sigOf(r.plan) !== current)
    .slice()
    .reverse()
    .map((r) => {
      const summary = src.summaries[r.reason];
      return {
        plan: describePlan(story, r.plan),
        name: nameOf(r.npc),
        label: RESPONSE_LABEL[r.status],
        ...(summary ? { summary } : {}),
      };
    });

  // 今の案の選択肢に関係する情報だけ（重複なし、知っているものだけ）
  const topicIds = new Set<TopicId>();
  if (draft) {
    for (const item of planning.items) for (const t of src.relevantTopics[item.id]?.[draft[item.id] ?? ''] ?? []) topicIds.add(t);
  }
  const considerations = [...topicIds]
    .map((t) => buildTopic(story, t, src))
    .filter((t) => t !== null)
    .map((t) => ({
      title: t.personName ? `${t.personName}｜${t.title}` : t.title,
      summary: t.summary,
      text: t.text,
    }));

  const outcomeTitle = decision ? src.outcomes[decision.outcome]?.title : undefined;
  return {
    phase: story.planPhase(),
    decided: decision !== null,
    ...(outcomeTitle ? { outcomeTitle } : {}),
    items,
    invalidReason: draft ? planning.invalidReason(draft) : null,
    forecast: draft ? src.forecast(draft, story) : [],
    responses,
    agreed,
    past,
    considerations,
    canDecide: story.planPhase() === 'ready',
  };
}

// ───────── 結果 ─────────

export interface OutcomeView {
  readonly title: string;
  readonly when: string;
  /** 自分が決めたこと。 */
  readonly decided: { readonly plan: string; readonly agreedBy: string };
  readonly story: readonly string[];
  /** その判断によって実現したこと。 */
  readonly achieved: readonly string[];
  /** その代わりに残った負担や約束。 */
  readonly costs: readonly string[];
  /** 承諾を得ていたが選ばなかった案。 */
  readonly notChosen: ReadonlyArray<{ readonly plan: string; readonly tagline: string }>;
}

/** 決定した計画の結果。知っていた情報によって文章が変わる。 */
export function buildOutcome(story: StoryState, outcomes: Readonly<Record<string, OutcomeDef>>, src?: JournalSources): OutcomeView | null {
  const decision = story.planDecision();
  const def = decision ? outcomes[decision.outcome] : undefined;
  const planning = story.defs.planning;
  if (!decision || !def || !planning) return null;
  const shown = (lines: OutcomeDef['story']) => lines.filter((l) => evaluate(l.when, story)).map((l) => l.text);
  const nameOf = (npc: string) => (src?.characters[npc] as CharacterDef | undefined)?.name ?? npc;
  const sig = story.planSignature(decision.plan);
  const notChosen = story
    .agreedPlans()
    .filter((p) => story.planSignature(p) !== sig)
    .map((p) => {
      const id = planning.outcome(p);
      return { plan: describePlan(story, p), tagline: (id && outcomes[id]?.tagline) || '' };
    });
  return {
    title: def.title,
    when: def.when,
    decided: {
      plan: describePlan(story, decision.plan),
      agreedBy: planning.involved(decision.plan).map(nameOf).join('・'),
    },
    story: shown(def.story),
    achieved: shown(def.achieved),
    costs: shown(def.costs),
    notChosen,
  };
}
