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
  /** 手帳に載せる記述。 */
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
}

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
}
