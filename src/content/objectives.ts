import { all, evaluate, flag, not, type Condition, type FlagReader } from '../story/conditions';

/**
 * 右上に出す短い目的（設計書 M 節）。上から順に条件を調べ、最初に成立したものを表示する。
 * Phase 1 の仮の内容。探索順は固定しないため、指示ではなく「次にできること」の案内に留める。
 */
export interface ObjectiveDef {
  readonly when?: Condition;
  readonly text: string;
}

export const OBJECTIVES: readonly ObjectiveDef[] = [
  { when: all(not(flag('talked:toki')), not(flag('talked:sae'))), text: '広場にいるトキに話しかける' },
  { when: not(flag('talked:sae')), text: 'サエ家を訪ねる' },
  {
    when: not(all(flag('talked:isuke'), flag('talked:sohei'), flag('talked:mine'))),
    text: '伊助・宗平・ミネに話を聞く',
  },
  { when: not(flag('fact:isukeHarvest')), text: '伊助が断った理由を探る' },
  { text: '聞いた話を確かめながら村を歩く' },
];

export function currentObjective(state: FlagReader, list: readonly ObjectiveDef[] = OBJECTIVES): string {
  return list.find((o) => evaluate(o.when, state))?.text ?? '';
}
