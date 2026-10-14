/**
 * 会話・選択肢・目的表示の出し分けに使う条件と、会話の結果として起きる効果。
 * データ（content/）に書き、StoryState に対して評価・適用する。
 *
 * Phase 1 ではフラグの有無だけを扱う。NPC ごとの状態や結帳など Phase 2 以降の条件は、
 * Condition / Effect の種類を追加して拡張する。
 */

/**
 * 物語上の出来事を表すフラグ。命名規則：
 * - `talked:<interactableId>` / `inspected:<interactableId>` … 会話・調査を一度終えた（自動で立つ）
 * - `fact:<name>` … 住民の事情など、プレイヤーが知った情報
 */
export type FlagId = string;

export type Condition =
  | { readonly flag: FlagId }
  | { readonly not: Condition }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] };

export type Effect = { readonly type: 'setFlag'; readonly flag: FlagId };

export interface FlagReader {
  has(flag: FlagId): boolean;
}

/** 条件なし（undefined）は常に成立する。 */
export function evaluate(condition: Condition | undefined, state: FlagReader): boolean {
  if (!condition) return true;
  if ('flag' in condition) return state.has(condition.flag);
  if ('not' in condition) return !evaluate(condition.not, state);
  if ('all' in condition) return condition.all.every((c) => evaluate(c, state));
  return condition.any.some((c) => evaluate(c, state));
}

/** 条件の中で参照しているフラグを列挙する（データ検証用）。 */
export function referencedFlags(condition: Condition | undefined): FlagId[] {
  if (!condition) return [];
  if ('flag' in condition) return [condition.flag];
  if ('not' in condition) return referencedFlags(condition.not);
  const list = 'all' in condition ? condition.all : condition.any;
  return list.flatMap(referencedFlags);
}

/** 記述を短くするためのヘルパー。 */
export const flag = (f: FlagId): Condition => ({ flag: f });
export const not = (c: Condition): Condition => ({ not: c });
export const all = (...c: Condition[]): Condition => ({ all: c });
export const any = (...c: Condition[]): Condition => ({ any: c });
export const setFlag = (f: FlagId): Effect => ({ type: 'setFlag', flag: f });
