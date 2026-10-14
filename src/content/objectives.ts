import { all, evaluate, flag, inChapter, knows, not, notYet, planPhase, type Condition, type StoryQuery } from '../story/conditions';
import { SAE_HOUSE_OPEN } from './house';

/**
 * 右上に出す短い目的（設計書 M 節）。上から順に条件を調べ、最初に成立したものを表示する。
 * docs/STATE_TABLE.md 第6節と対応する。探索順は固定しないため、指示ではなく「次にできること」の案内に留める。
 */
export interface ObjectiveDef {
  readonly when?: Condition;
  readonly text: string;
}

export const OBJECTIVES: readonly ObjectiveDef[] = [
  // エンディングの後
  { when: inChapter('end'), text: '物語はここまで。村を歩き、結帳や手帳を見返せる' },
  // 第3幕
  { when: all(inChapter('ch3'), not(flag('ch3:isuke'))), text: '伊助に、伊助家の屋根葺きの話を聞く' },
  { when: all(inChapter('ch3'), planPhase('revise')), text: '返事をふまえて、伊助家の屋根葺きの案を見直す' },
  { when: all(inChapter('ch3'), planPhase('pending')), text: '作業台でまとめた案を、関係する人に相談する' },
  { when: all(inChapter('ch3'), planPhase('ready')), text: '全員が承知した。作業台で伊助家の屋根葺きを決める' },
  { when: all(inChapter('ch3'), knows('isuke.roof3')), text: '宗平の作業台で、伊助家の屋根葺きの段取りを考える' },
  // 屋根葺き当日
  { when: inChapter('roofDay'), text: '屋根葺きの日の村を見て回る（サエと話すと一日を終えられる）' },
  // 第1幕・第2幕
  { when: all(not(flag('talked:toki')), not(flag('talked:sae'))), text: '広場にいるトキに話しかける' },
  { when: not(flag('talked:sae')), text: 'サエ家を訪ねる' },
  { when: planPhase('revise'), text: '返事をふまえて、作業台で案を見直す' },
  { when: planPhase('pending'), text: '作業台でまとめた案を、関係する人に相談する' },
  { when: planPhase('ready'), text: '全員が承知した。作業台で計画を決める（決めると変えられない）' },
  { when: not(flag('talked:isuke')), text: '伊助に屋根葺きの手伝いを相談する' },
  { when: notYet('isuke.availability', 'harvest'), text: '伊助が断った理由を探る' },
  // Phase 5.5：結帳はサエ家の室内。まずサエに頼んで上がらせてもらう
  { when: all(notYet('ledger.basics', 'read'), not(SAE_HOUSE_OPEN)), text: 'サエに、結帳を見せてもらえるか頼む' },
  { when: notYet('ledger.basics', 'read'), text: 'サエ家に上がって、結帳を確かめる' },
  { when: not(all(flag('talked:sohei'), flag('talked:mine'))), text: '宗平とミネにも話を聞く（段取りと茅のこと）' },
  { text: '宗平の作業台で、屋根葺きの段取りを考える' },
];

export function currentObjective(state: StoryQuery, list: readonly ObjectiveDef[] = OBJECTIVES): string {
  return list.find((o) => evaluate(o.when, state))?.text ?? '';
}
