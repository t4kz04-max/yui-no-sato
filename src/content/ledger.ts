import type { HouseholdId, TopicId } from '../story/types';

/**
 * サエ家の結帳（過去の協力の記録）。docs/STATE_TABLE.md 第4節の【暫定案】。
 *
 * - ゲーム用に創作した記録であり、史実の結帳の書式・内容を再現したものではない（画面にも明記する）。
 * - 第1章のあいだは変化しない「過去」の記録。住民の現在の意向（StoryState）とは別に持つ。
 * - 数値の合計や貸し借りの点数は出さない。誰が・どの家に・何をしたか、返しはどうなったかを書く。
 */
export type LedgerItemKind = 'labor' | 'material';

export const LEDGER_KIND_LABEL: Record<LedgerItemKind, string> = {
  labor: '人手',
  material: '資材',
};

export type LedgerSettlement = 'open' | 'settled' | 'none';

export const SETTLEMENT_LABEL: Record<LedgerSettlement, string> = {
  open: '返し まだ',
  settled: '返し 済',
  none: '取り決めなし',
};

export interface LedgerItem {
  readonly id: string;
  readonly from: HouseholdId;
  readonly to: HouseholdId;
  readonly kind: LedgerItemKind;
  readonly detail: string;
  /** 返しの状態。open＝まだ、settled＝済、none＝返しの取り決めが記されていない。 */
  readonly settlement: LedgerSettlement;
  readonly settlementNote: string;
}

export interface LedgerEntry {
  readonly id: string;
  /** いつのことか（時代設定は未確定のため相対的な表記にする）。 */
  readonly when: string;
  readonly title: string;
  readonly items: readonly LedgerItem[];
  /** 画面で「今わかっていること（手帳より）」として並べる、関連する情報。 */
  readonly relatedTopics: readonly TopicId[];
}

export const LEDGER_TITLE = 'サエ家 結帳';

export const LEDGER_NOTE =
  'この結帳は、ゲームのために創作した記録です。実際の白川郷の結帳の書式や内容を再現したものではありません。';

export const LEDGER: readonly LedgerEntry[] = [
  {
    id: 'L1',
    when: '十二年前の秋',
    title: 'サエ家 屋根葺き（南面）',
    items: [
      {
        id: 'L1-isuke',
        from: 'isuke',
        to: 'sae',
        kind: 'labor',
        detail: '二人・二日（茅運び、下の仕事）',
        settlement: 'open',
        settlementNote: 'まだ返していない。伊助家の屋根葺きの折に返す。',
      },
      {
        id: 'L1-mine',
        from: 'mine',
        to: 'sae',
        kind: 'material',
        detail: '茅 三十束',
        settlement: 'settled',
        settlementNote: '七年前、ミネ家の屋根葺きに茅三十束を出して返した（L2）。',
      },
      {
        id: 'L1-sohei',
        from: 'sohei',
        to: 'sae',
        kind: 'labor',
        detail: '一人（屋根の上の段取り）',
        settlement: 'settled',
        settlementNote: '宗平の作業小屋の普請に一人出して返した。',
      },
    ],
    relatedTopics: ['isuke.pastHelp', 'isuke.availability', 'mine.kaya', 'sohei.roles'],
  },
  {
    id: 'L2',
    when: '七年前の秋',
    title: 'ミネ家 屋根葺き（北面）',
    items: [
      {
        id: 'L2-sae',
        from: 'sae',
        to: 'mine',
        kind: 'material',
        detail: '茅 三十束（十二年前に借りた分の返し）',
        settlement: 'settled',
        settlementNote: 'これで十二年前の茅の借りは返した。',
      },
    ],
    relatedTopics: ['mine.kaya'],
  },
];
