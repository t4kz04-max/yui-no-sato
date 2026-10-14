import type { ConsentStatus, FlagId, HouseholdId, NpcId, PlanPhase, RequestId, StageId, TopicId } from './types';

export type { FlagId } from './types';

/**
 * 会話・選択肢・目的表示の出し分けに使う条件と、会話の結果として起きる効果。
 * データ（content/）に書き、StoryState に対して評価・適用する。
 */

/**
 * フラグの命名規則：
 * - `talked:<interactableId>` / `inspected:<interactableId>` … 会話・調査を最後まで終えた（自動で立つ）
 * - `visited:<地点ID>` … 主要地点に入った（自動で立つ）
 */
export type Condition =
  | { readonly flag: FlagId }
  | { readonly not: Condition }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  /**
   * 情報を知っているか。atLeast：その段階以上を知っている。below：その段階にまだ達していない（未取得を含む）。
   * どちらも省略すると「何らかの段階を知っている」。
   */
  | { readonly topic: TopicId; readonly atLeast?: StageId; readonly below?: StageId }
  /** 住民の現在の意向。'none' はまだ聞いていない。 */
  | { readonly consentOf: NpcId; readonly request: RequestId; readonly is: readonly (ConsentStatus | 'none')[] }
  /** 計画の進み具合。 */
  | { readonly planPhase: readonly PlanPhase[] }
  /** 今の案について、この住民にまだ相談していない（相談が必要な人に限る）。 */
  | { readonly planPending: NpcId }
  /** 今の案に対するこの住民の返事の理由。 */
  | { readonly planReason: NpcId; readonly is: readonly string[] }
  /** 決定した計画の結果。 */
  | { readonly outcome: readonly string[] };

export type Effect =
  | { readonly type: 'setFlag'; readonly flag: FlagId }
  | { readonly type: 'learn'; readonly topic: TopicId; readonly stage: StageId }
  | {
      readonly type: 'setConsent';
      readonly npc: NpcId;
      readonly request: RequestId;
      readonly status: ConsentStatus;
      readonly note?: string;
    }
  /** 今の案を住民に相談し、返事を記録する。 */
  | { readonly type: 'consultPlan'; readonly npc: NpcId }
  | {
      readonly type: 'recordPromise';
      readonly id: string;
      readonly from: HouseholdId;
      readonly to: HouseholdId;
      readonly content: string;
    };

/** 条件の評価に必要な問い合わせ（StoryState が実装する）。 */
export interface StoryQuery {
  has(flag: FlagId): boolean;
  /** 知っている最も進んだ段階の順位。未取得は -1。 */
  topicRank(topic: TopicId): number;
  /** 段階の順位（定義にない段階は例外）。 */
  stageRank(topic: TopicId, stage: StageId): number;
  consentStatus(npc: NpcId, request: RequestId): ConsentStatus | undefined;
  planPhase(): PlanPhase;
  /** 今の案について未相談か（相談が必要な人で、まだ返事がない）。 */
  isPlanPending(npc: NpcId): boolean;
  /** 今の案に対する返事の理由。 */
  planReason(npc: NpcId): string | undefined;
  outcome(): string | undefined;
}

/** 条件なし（undefined）は常に成立する。 */
export function evaluate(condition: Condition | undefined, state: StoryQuery): boolean {
  if (!condition) return true;
  if ('flag' in condition) return state.has(condition.flag);
  if ('not' in condition) return !evaluate(condition.not, state);
  if ('all' in condition) return condition.all.every((c) => evaluate(c, state));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, state));
  if ('topic' in condition) {
    const rank = state.topicRank(condition.topic);
    if (condition.atLeast !== undefined && rank < state.stageRank(condition.topic, condition.atLeast)) return false;
    if (condition.below !== undefined && rank >= state.stageRank(condition.topic, condition.below)) return false;
    if (condition.atLeast === undefined && condition.below === undefined) return rank >= 0;
    return true;
  }
  if ('planPhase' in condition) return condition.planPhase.includes(state.planPhase());
  if ('planPending' in condition) return state.isPlanPending(condition.planPending);
  if ('planReason' in condition) {
    const reason = state.planReason(condition.planReason);
    return reason !== undefined && condition.is.includes(reason);
  }
  if ('outcome' in condition) {
    const outcome = state.outcome();
    return outcome !== undefined && condition.outcome.includes(outcome);
  }
  const status = state.consentStatus(condition.consentOf, condition.request) ?? 'none';
  return condition.is.includes(status);
}

/** 条件の中で参照しているもの（データ検証用）。 */
export interface ConditionRefs {
  flags: FlagId[];
  topics: Array<{ topic: TopicId; stage?: StageId }>;
  consents: Array<{ npc: NpcId; request: RequestId }>;
  /** 計画の理由・結果として参照した ID。 */
  planReasons: Array<{ npc: NpcId; reason: string }>;
  outcomes: string[];
}

export function collectRefs(condition: Condition | undefined, into?: ConditionRefs): ConditionRefs {
  const refs = into ?? { flags: [], topics: [], consents: [], planReasons: [], outcomes: [] };
  if (!condition) return refs;
  if ('flag' in condition) refs.flags.push(condition.flag);
  else if ('not' in condition) collectRefs(condition.not, refs);
  else if ('all' in condition) condition.all.forEach((c) => collectRefs(c, refs));
  else if ('any' in condition) condition.any.forEach((c) => collectRefs(c, refs));
  else if ('topic' in condition) {
    refs.topics.push({ topic: condition.topic });
    if (condition.atLeast) refs.topics.push({ topic: condition.topic, stage: condition.atLeast });
    if (condition.below) refs.topics.push({ topic: condition.topic, stage: condition.below });
  } else if ('planReason' in condition) {
    condition.is.forEach((reason) => refs.planReasons.push({ npc: condition.planReason, reason }));
  } else if ('outcome' in condition) refs.outcomes.push(...condition.outcome);
  else if ('consentOf' in condition) refs.consents.push({ npc: condition.consentOf, request: condition.request });
  return refs;
}

/** 条件の中で参照しているフラグを列挙する（データ検証用）。 */
export function referencedFlags(condition: Condition | undefined): FlagId[] {
  return collectRefs(condition).flags;
}

/** 記述を短くするためのヘルパー。 */
export const flag = (f: FlagId): Condition => ({ flag: f });
export const not = (c: Condition): Condition => ({ not: c });
export const all = (...c: Condition[]): Condition => ({ all: c });
export const any = (...c: Condition[]): Condition => ({ any: c });
export const knows = (topic: TopicId, atLeast?: StageId): Condition =>
  atLeast === undefined ? { topic } : { topic, atLeast };
export const notYet = (topic: TopicId, below: StageId): Condition => ({ topic, below });
export const consentIs = (npc: NpcId, request: RequestId, ...is: (ConsentStatus | 'none')[]): Condition => ({
  consentOf: npc,
  request,
  is,
});

export const setFlag = (f: FlagId): Effect => ({ type: 'setFlag', flag: f });
export const learn = (topic: TopicId, stage: StageId): Effect => ({ type: 'learn', topic, stage });
export const setConsent = (npc: NpcId, request: RequestId, status: ConsentStatus, note?: string): Effect =>
  note === undefined ? { type: 'setConsent', npc, request, status } : { type: 'setConsent', npc, request, status, note };
export const planPhase = (...phases: PlanPhase[]): Condition => ({ planPhase: phases });
export const planPending = (npc: NpcId): Condition => ({ planPending: npc });
export const planReason = (npc: NpcId, ...is: string[]): Condition => ({ planReason: npc, is });
export const outcomeIs = (...outcomes: string[]): Condition => ({ outcome: outcomes });
export const consultPlan = (npc: NpcId): Effect => ({ type: 'consultPlan', npc });
