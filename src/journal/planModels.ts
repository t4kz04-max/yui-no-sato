import type { CharacterDef } from '../content/characters';
import type { OutcomeDef } from '../content/plan';
import { evaluate } from '../story/conditions';
import type { StoryState } from '../story/StoryState';
import { CONSENT_LABEL, type ConsentStatus, type PlanPhase, type PlanSpec, type TopicId } from '../story/types';
import { buildTopic, type JournalSources } from './models';

/**
 * 作業台（計画）と結果画面の表示内容を、ゲーム状態と定義から組み立てる（DOM 非依存）。
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

export interface PlanBoardModel {
  readonly phase: PlanPhase;
  readonly decided: boolean;
  readonly outcomeTitle?: string;
  readonly items: readonly PlanItemView[];
  readonly invalidReason: string | null;
  /** 今の案に返事が必要な人と、その返事。 */
  readonly responses: readonly PlanResponseView[];
  /** 以前の案への返事（比べて考えるため）。新しい順。 */
  readonly past: readonly PastResponseView[];
  /** 判断の材料として、手帳で知っていること。 */
  readonly considerations: ReadonlyArray<{ readonly title: string; readonly text: string }>;
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
  /** 作業台で「考えておくこと」として並べる情報。 */
  readonly considerationTopics: readonly TopicId[];
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

  const considerations = src.considerationTopics
    .map((t) => buildTopic(story, t, src))
    .filter((t) => t !== null)
    .map((t) => ({ title: t.personName ? `${t.personName}｜${t.title}` : t.title, text: t.text }));

  const outcomeTitle = decision ? src.outcomes[decision.outcome]?.title : undefined;
  return {
    phase: story.planPhase(),
    decided: decision !== null,
    ...(outcomeTitle ? { outcomeTitle } : {}),
    items,
    invalidReason: draft ? planning.invalidReason(draft) : null,
    responses,
    past,
    considerations,
    canDecide: story.planPhase() === 'ready',
  };
}

// ───────── 結果 ─────────

export interface OutcomeView {
  readonly title: string;
  readonly when: string;
  readonly plan: string;
  readonly story: readonly string[];
  readonly changes: ReadonlyArray<{ readonly label: string; readonly text: string }>;
}

/** 決定した計画の結果。知っていた情報によって文章が変わる。 */
export function buildOutcome(story: StoryState, outcomes: Readonly<Record<string, OutcomeDef>>): OutcomeView | null {
  const decision = story.planDecision();
  const def = decision ? outcomes[decision.outcome] : undefined;
  if (!decision || !def) return null;
  return {
    title: def.title,
    when: def.when,
    plan: describePlan(story, decision.plan),
    story: def.story.filter((l) => evaluate(l.when, story)).map((l) => l.text),
    changes: def.changes,
  };
}
