import { all, evaluate, flag, not, notYet, planPhase, type Condition, type StoryQuery } from '../story/conditions';

/**
 * 右上に出す短い目的（設計書 M 節）。上から順に条件を調べ、最初に成立したものを表示する。
 * docs/STATE_TABLE.md 第6節と対応する。探索順は固定しないため、指示ではなく「次にできること」の案内に留める。
 */
export interface ObjectiveDef {
  readonly when?: Condition;
  readonly text: string;
}

export const OBJECTIVES: readonly ObjectiveDef[] = [
  { when: planPhase('decided'), text: '屋根葺きを終えた村を歩き、みんなの様子を見る' },
  { when: all(not(flag('talked:toki')), not(flag('talked:sae'))), text: '広場にいるトキに話しかける' },
  { when: not(flag('talked:sae')), text: 'サエ家を訪ねる' },
  { when: planPhase('revise'), text: '返事をふまえて、作業台で案を見直す' },
  { when: planPhase('pending'), text: '作業台でまとめた案を、関係する人に相談する' },
  { when: planPhase('ready'), text: '全員が承知した。作業台で計画を決める（決めると変えられない）' },
  { when: not(flag('talked:isuke')), text: '伊助に屋根葺きの手伝いを相談する' },
  { when: notYet('isuke.availability', 'harvest'), text: '伊助が断った理由を探る' },
  { when: notYet('ledger.basics', 'read'), text: 'サエ家の結帳を確かめる' },
  { text: '宗平の作業台で、屋根葺きの段取りを考える' },
];

export function currentObjective(state: StoryQuery, list: readonly ObjectiveDef[] = OBJECTIVES): string {
  return list.find((o) => evaluate(o.when, state))?.text ?? '';
}
