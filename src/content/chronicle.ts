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

/**
 * 史実と創作の区別（設計書 B 節。Phase 6 で 4 区分に整理）。ゲーム内の解説画面に出す。
 *
 * - 「確認できる事実」には、出典で確認できたことだけを書く（出典は sources）。
 * - 設計書 B 節の記述のうち、上の出典で確認できなかったものは「出典を確認中」として分けて残す（書き換えない）。
 * - Phase 4 の暫定設定（🔶）は「創作した設定」に入れ、史実として扱わない。
 */
export interface ExplainSection {
  readonly id: 'facts' | 'pending' | 'simplified' | 'people' | 'settings';
  readonly heading: string;
  readonly lead: string;
  readonly items: readonly string[];
}

export interface ExplainContent {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly ExplainSection[];
  readonly sources: ReadonlyArray<{ readonly title: string; readonly url: string }>;
  readonly notes: readonly string[];
}

export const EXPLAIN: ExplainContent = {
  title: '史実と創作について',
  intro:
    'このゲームは、岐阜県白川村（白川郷）の「結（ゆい）」を題材にした創作です。舞台の村・人物・出来事は架空で、実在の家や住民を描いたものではありません。',
  sections: [
    {
      id: 'facts',
      heading: '1. 資料で確認できる事実',
      lead: '下の出典（観光庁 多言語解説文データベース・白川村）で確認できたこと。',
      items: [
        '白川郷では、厳格な互恵関係を前提とする助け合いの精神を「結」と呼ぶ。屋根の葺き替えは、その最も身近な例とされる。',
        '茅葺き屋根の葺き替えには多くの村人が加わった（大きな家では百人から二百人）。伝統的には一日で葺き終えた。',
        '役割は分かれていた。年長者が作業を見て、若い人は茅の束を運んだり片付けをしたりした。地上では茅の運搬や食事の用意も行った。',
        '「結帳」と呼ばれる帳面に、作業の内容、葺き材の用意、宴席の酒の本数などが記録され、公平さと互恵関係を保つ役割を持った。現存する最古の結帳は 1792 年のもの。',
        '現在の葺き替えの多くは専門の職人が行う。一方で、村人が年に一度以上集まり、技術を伝えるために結の精神で屋根を葺いている。',
        '合掌造りの 1 階は暮らしの場で、入口近くの土間、囲炉裏のある居間などがある（サエ家の室内の間取りの参考にした）。',
      ],
    },
    {
      id: 'pending',
      heading: '2. 設計で前提にしているが、出典を確認中のこと',
      lead: '開発の設計書に書いた内容。上の出典では確認できていないため、断定せずにここに分けておく。',
      items: [
        '結は、原則として労働を返す相互の交換であること。',
        '「合力（こうりょく）」は、見返りを条件としない手伝いで、結とは区別されること。',
        '後に協力を返す「結返し」と呼ばれる仕組みがあったこと。',
      ],
    },
    {
      id: 'simplified',
      heading: '3. ゲームのために単純化した仕組み',
      lead: '判断の仕組みを短い時間で体験できるように、実際よりも単純にしている。',
      items: [
        '登場する数軒の家だけで屋根葺きを相談する（実際の大きな屋根を、数軒の家だけで葺けたという意味ではない）。',
        '日取り・頼み方・茅の借り方を作業台で組み合わせ、関係する人の承諾がそろった案だけを決められる。',
        '返事は、その人の今の事情と提案の内容だけで決まる。過去の貸し借り（結帳の記録）で、相手に参加を強いることはできない。',
        '屋根の片面（南面）だけを葺き替える、茅を一年後に茅で返す、などの取り決め。',
        '結帳の画面の書式と記載内容（史実の結帳の再現ではない）。',
      ],
    },
    {
      id: 'people',
      heading: '4. 架空の人物・出来事',
      lead: '実在の人物・家をモデルにしたものではない。',
      items: [
        '舞台の村、トキ・サエ・伊助・宗平・ミネと、その家族・人物どうしの関係。',
        'サエ家の屋根が傷んだ事情、伊助家の刈り入れとの重なり、ミネ家の茅の蓄え、十五年前に伊助家がサエ家を手伝ったこと。',
        '住民の会話、作業台の選択肢、屋根葺きの日の様子、結果とエンディング（E1〜E3）。',
      ],
    },
    {
      id: 'settings',
      heading: '5. 物語のために作った設定（暫定）',
      lead: '開発の途中で仮に決めた設定。史実として扱わない。',
      items: [
        '宗平が、村の茅場の茅刈りを仕切る役目を持っていること。',
        'ミネが、宗平の代わりに茅刈りを仕切れること（その代わりに茅を貸せること）。',
        '三年後、サエが足を痛めていること。',
        '第1幕で交わした約束が、三年のあいだに果たされたこと。',
        '三年後に伊助家の屋根を葺き替えることになる展開。',
      ],
    },
  ],
  sources: [
    { title: '観光庁 多言語解説文データベース「結（ゆい）」（白川村）', url: 'https://www.mlit.go.jp/tagengo-db/R2-00129.html' },
    { title: '観光庁 多言語解説文データベース「結（ゆい）」（白川村 荻町）', url: 'https://www.mlit.go.jp/tagengo-db/R5-00142.html' },
    { title: '観光庁 多言語解説文データベース「House Layout and Room Use」（白川村）', url: 'https://www.mlit.go.jp/tagengo-db/en/R5-00135.html' },
  ],
  notes: [
    '出典の確認は 2026-10-15 時点。2 の項目は、公開前に出典を確認したうえで表現を見直す（出典は確認中）。',
    'サエ家の室内は、資料の一般的な間取りを参考にした創作で、特定の家の再現ではない。',
  ],
};
