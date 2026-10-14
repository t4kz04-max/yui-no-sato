import type { StoryState } from '../story/StoryState';
import { LEDGER, type LedgerEntry } from './ledger';
import { OUTCOMES, parseOutcomeId } from './plan';

/**
 * 章の進行に応じた結帳の中身（過去の記録＋その後に起きたこと）。
 * 結帳は「記録」なので、実際に起きたことだけを書き加える。返事・承諾はここでは決まらない。
 *
 * 三年のあいだの出来事（🔶 暫定設定）：第1幕で交わした約束（刈り入れの手伝い・茅の返し）は果たされた。
 */

/** 第3幕に入るときに「果たした」とする約束。 */
export const PROMISES_KEPT_BY_CH3: readonly string[] = ['saeHelpsIsukeHarvest', 'saeReturnsKaya'];

export function ledgerEntries(story: StoryState): LedgerEntry[] {
  const roof = story.planDecision('roof');
  const isukeRoof = story.planDecision('isukeRoof');
  const later = story.chapter === 'ch3' || story.chapter === 'end';
  const entries: LedgerEntry[] = [];

  for (const e of LEDGER) {
    if (e.id === 'L1' && isukeRoof?.outcome === 'e1') {
      entries.push({
        ...e,
        items: e.items.map((i) =>
          i.id === 'L1-isuke'
            ? { ...i, settlement: 'settled', settlementNote: '十五年後、伊助家の屋根葺きで、下の仕事を引き受けて返した（伊助と話して記した）。' }
            : i,
        ),
      });
    } else entries.push(e);
  }

  const act1 = roof ? OUTCOMES[roof.outcome] : undefined;
  if (act1) {
    const o = parseOutcomeId(act1.id);
    entries.push({
      ...act1.ledger,
      items: act1.ledger.items.map((i) => {
        if (!later) return i;
        if (i.id === 'L3-mine') return { ...i, settlement: 'settled', settlementNote: '翌年の秋、同じ束数を茅で返した（記したとおり）。' };
        if (i.id === 'L3-isuke' && o?.family === 'prep') {
          return { ...i, settlement: 'settled', settlementNote: 'その秋、サエ家が伊助家の刈り入れを手伝って返した。' };
        }
        return i;
      }),
    });
  }

  if (isukeRoof && isukeRoof.outcome !== 'e3') {
    const items: LedgerEntry['items'][number][] = [
      {
        id: 'L4-village',
        from: 'village',
        to: 'isuke',
        kind: 'labor',
        detail: '数人・一日',
        settlement: 'open',
        settlementNote: 'それぞれの家の屋根葺きの折に返す。',
      },
    ];
    if (isukeRoof.outcome === 'e1') {
      items.unshift({
        id: 'L4-sae',
        from: 'sae',
        to: 'isuke',
        kind: 'labor',
        detail: '一人・一日（下の仕事：茅の受け渡し、片付け）',
        settlement: 'settled',
        settlementNote: '十五年前の手伝いの返しとして（L1）。屋根の上ではないが、本人どうしで話して記した。',
      });
    }
    entries.push({
      id: 'L4',
      when: '三年後の秋',
      title: '伊助家 屋根葺き',
      items,
      relatedTopics: ['isuke.roof3', 'sae.later', 'isuke.pastHelp'],
    });
  }
  return entries;
}

/** 史実と創作の区別（設計書 B 節）。ゲーム内の解説画面に出す。 */
export const EXPLAIN = {
  title: '史実と創作について',
  history: {
    heading: '史実に基づく要素（設計書 B 節）',
    items: [
      '白川郷の「結（ゆい）」は、原則として労働を返す相互の交換である。',
      '「合力（こうりょく）」は、見返りを条件としない手伝いであり、結とは区別される。',
      '屋根葺きには多くの協力者と、異なる役割が必要だった。',
      '結帳には、協力した人や資材が記録された。',
      '後に協力を返す「結返し」の仕組みがあった。',
      '現在の屋根の維持は、歴史的な結とは異なる形も取っている。',
    ],
  },
  fiction: {
    heading: 'ゲーム用の創作',
    items: [
      '舞台の村、登場人物、人物どうしの関係（実在の住民をモデルにしたものではない）',
      '屋根葺きが必要になった事情、日程の調整、住民の会話',
      '作業台の計画・選択肢・結果・エンディング',
      '画面に出てくる結帳の書式と記載内容（史実の結帳の再現ではない）',
      '宗平の茅刈りの役目、ミネが茅刈りを仕切れば茅を貸せること、サエの足のけが、三年後の出来事',
      '少ない世帯で判断の仕組みを体験するための単純化',
    ],
  },
  notes: [
    '作中に登場する数世帯だけで、実際の大きな合掌造りの屋根を葺けたという意味ではない。',
    '参考資料：出典は確認中（公開前に整備する）。ここに書いた史実の要素も、出典を確認したうえで表現を見直す。',
  ],
} as const;
