import type { Condition, Effect } from './conditions';

/**
 * 物語の状態を構成するデータの定義（docs/STATE_TABLE.md と対応）。
 * 定義（何がありうるか）は content/ に置き、StoryState は「今どうなっているか」だけを持つ。
 */

export type FlagId = string;
export type TopicId = string;
export type StageId = string;
export type RequestId = string;
/** 住民（人物 ID）。 */
export type NpcId = string;
/** 家（結帳・約束の当事者）。 */
export type HouseholdId = string;

/** 手帳の区分。「約束」は別データ（PromiseRecord）で持つ。 */
export type TopicCategory = 'known' | 'unconfirmed';

export interface TopicStageDef {
  readonly id: StageId;
  readonly category: TopicCategory;
  /** 要点（短い一句）。手帳・作業台・通知で最初に見せる。 */
  readonly summary?: string;
  /** 手帳に載せる記述（全文）。 */
  readonly text: string;
}

/**
 * プレイヤーが知りうる情報のまとまり（例：伊助の当日の都合）。
 * 段階は配列の順に進み、後の段階ほど詳しい。前の段階は「経緯」として残る。
 */
export interface TopicDef {
  readonly id: TopicId;
  readonly title: string;
  /** 関係する人物（手帳の「人物」に表示する）。 */
  readonly person?: NpcId;
  readonly stages: readonly TopicStageDef[];
}

/** 住民に意向を尋ねる事柄（例：屋根葺き当日の手伝い）。 */
export interface RequestDef {
  readonly id: RequestId;
  readonly label: string;
}

/**
 * 住民の現在の意向。本人が表明したときだけ記録する（未記録＝まだ聞いていない）。
 * 過去の協力（結帳）とは別に持ち、過去の記録から自動で決まることはない。
 */
export type ConsentStatus = 'declined' | 'conditional' | 'agreed';

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  declined: '断っている',
  conditional: '条件付き',
  agreed: '承諾',
};

/** 物語の定義一式。StoryState の検証と段階の順序の判定に使う。 */
export interface StoryDefinitions {
  readonly topics: Readonly<Record<TopicId, TopicDef>>;
  readonly requests: Readonly<Record<RequestId, RequestDef>>;
  readonly npcs: readonly NpcId[];
  readonly households: readonly HouseholdId[];
  /** 計画の定義（計画 ID → 定義）。ないときは計画を扱わない。 */
  readonly plans?: Readonly<Record<PlanId, PlanningDefs>>;
  /** その章で作業台に広げる計画（なければ null）。 */
  readonly planForChapter?: (chapter: Chapter) => PlanId | null;
}

/**
 * 章。ch1＝第1幕・第2幕（探索と計画）／roofDay＝屋根葺き当日／ch3＝第3幕（三年後）／end＝エンディングの後。
 */
export type Chapter = 'ch1' | 'roofDay' | 'ch3' | 'end';
export const CHAPTERS: readonly Chapter[] = ['ch1', 'roofDay', 'ch3', 'end'];
/** 章の名前（タイトル画面の「前回の記録」などに出す。Phase 6）。 */
export const CHAPTER_LABEL: Record<Chapter, string> = { ch1: '屋根葺きの相談', roofDay: '屋根葺きの日', ch3: '三年後の秋（第3幕）', end: 'エンディングの後' };

/** 計画の種類（例：roof＝サエ家の屋根葺き、isukeRoof＝伊助家の屋根葺き）。 */
export type PlanId = string;

// ───────── 現在の状態（保存対象） ─────────

/** 情報を得た記録。order はゲーム内で起きた順番（取得順の表示と保存に使う）。 */
export interface LearnedStage {
  readonly topic: TopicId;
  readonly stage: StageId;
  readonly order: number;
  /** どこで知ったか（例：「伊助と話した」）。 */
  readonly source?: string;
}

export interface ConsentEntry {
  readonly request: RequestId;
  readonly status: ConsentStatus;
  /** 本人が付けた条件・理由の要約（例：「予定日なら来られる」）。 */
  readonly note?: string;
  readonly order: number;
  readonly source?: string;
}

export interface NpcStateSnapshot {
  readonly id: NpcId;
  readonly met: boolean;
  /** 意向の履歴（古い順）。依頼ごとの最新が現在の意向。 */
  readonly consents: readonly ConsentEntry[];
}

/** 合意された今後の協力（第2幕以降で発生。Phase 2 では構造のみ）。 */
export interface PromiseRecord {
  readonly id: string;
  readonly from: HouseholdId;
  readonly to: HouseholdId;
  readonly content: string;
  readonly order: number;
  readonly source?: string;
}

export interface StorySnapshot {
  readonly clock: number;
  readonly flags: readonly FlagId[];
  readonly learned: readonly LearnedStage[];
  readonly npcs: readonly NpcStateSnapshot[];
  readonly promises: readonly PromiseRecord[];
  readonly chapter: Chapter;
  /** 計画 ID ごとの案・返事・決定。 */
  readonly plans: Readonly<Record<PlanId, PlanSnapshot>>;
}

// ───────── 計画（Phase 3） ─────────

/** 計画の案：項目 ID → 選んだ選択肢 ID。 */
export type PlanSpec = Readonly<Record<string, string>>;

/**
 * 計画の進み具合。
 * none：案がない／pending：未相談の人がいる／revise：断り・条件付きの返事がある／ready：全員承諾／decided：決定済み
 */
export type PlanPhase = 'none' | 'pending' | 'revise' | 'ready' | 'decided';

/** 住民の、ある案に対する返事。同じ案には同じ返事をする（今の事情と提案内容だけで決まる）。 */
export interface PlanResponse {
  readonly npc: NpcId;
  readonly plan: PlanSpec;
  readonly status: ConsentStatus;
  /** 返事の理由（content/plan.ts の理由 ID）。 */
  readonly reason: string;
  readonly order: number;
  readonly source?: string;
}

export interface PlanDecision {
  readonly plan: PlanSpec;
  readonly outcome: string;
  readonly order: number;
}

export interface PlanSnapshot {
  readonly draft: PlanSpec | null;
  readonly responses: readonly PlanResponse[];
  readonly decision: PlanDecision | null;
}

export interface PlanOptionDef {
  readonly id: string;
  readonly label: string;
  /** 補足（作業台に表示）。 */
  readonly detail?: string;
  /** 選べるようになる条件（未取得の情報を前提にした選択肢は出さない）。 */
  readonly when?: Condition;
  /** 作業台には出さない（他の項目に合わせて自動で選ばれる値）。 */
  readonly hidden?: boolean;
}

export interface PlanItemDef {
  readonly id: string;
  readonly label: string;
  readonly options: readonly PlanOptionDef[];
  /** この項目を作業台に出すか（例：茅を借りるときだけ返し方を出す）。省略時は常に出す。 */
  readonly visibleWhen?: (plan: PlanSpec) => boolean;
}

export interface PlanRule {
  readonly status: ConsentStatus;
  readonly reason: string;
}

/**
 * 計画の規則（content/plan.ts）。返事・結果は案の内容だけで決まる純粋関数にする
 * （過去の貸し借り・会話の回数・好感度は入力にしない）。
 */
export interface PlanningDefs {
  readonly id: PlanId;
  /** 作業台の見出し（例：「サエ家の屋根葺きの段取り」）。 */
  readonly title: string;
  readonly items: readonly PlanItemDef[];
  /** 項目どうしの依存を整える（例：茅を借りないなら返し方は「なし」）。省略時はそのまま。 */
  normalize?(plan: PlanSpec): PlanSpec;
  /** 案として成り立たない理由。成り立つときは null。 */
  invalidReason(plan: PlanSpec): string | null;
  /** その案に返事が必要な住民。 */
  involved(plan: PlanSpec): NpcId[];
  respond(npc: NpcId, plan: PlanSpec): PlanRule;
  /** 全員が承諾した案の結果 ID（成立しない案は null）。 */
  outcome(plan: PlanSpec): string | null;
  /** 決定したときに状態へ適用する効果。 */
  outcomeEffects(outcome: string): readonly Effect[];
}
