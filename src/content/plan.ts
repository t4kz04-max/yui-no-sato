import { all, knows, learn, setConsent, setFlag, type Condition, type Effect } from '../story/conditions';
import type { NpcId, PlanItemDef, PlanningDefs, PlanRule, PlanSpec } from '../story/types';
import type { LedgerEntry } from './ledger';

/**
 * 縦切り試作の計画（docs/VERTICAL_SLICE.md）。サエ家の屋根葺きと伊助家の刈り入れの日程の衝突。
 *
 * - 返事・結果は「今の事情と提案内容」だけで決まる純粋関数。過去の貸し借り（結帳）・会話の回数・
 *   好感度は入力にしない（過去の協力と現在の同意を混同しない）。
 * - すべてゲーム用の仮設定。宗平・ミネの計画への関わりは Phase 4 で扱う。
 */

export const PLAN_ITEMS: readonly PlanItemDef[] = [
  {
    id: 'date',
    label: '日取り',
    options: [
      { id: 'keep', label: '予定日のまま', detail: 'サエ家が決めていた日に葺く' },
      {
        id: 'afterHarvest',
        label: '伊助家の刈り入れの後に延ばす',
        detail: '待つあいだ、屋根の傷みは進む',
        when: knows('isuke.availability', 'harvest'),
      },
    ],
  },
  {
    id: 'isuke',
    label: '伊助への頼み方',
    options: [
      { id: 'none', label: '頼まない', detail: 'サエ家の人と、手の空いた村の人で葺く' },
      { id: 'dayOf', label: '当日の手伝いを頼む', detail: '屋根葺きの日に一日来てもらう' },
      {
        id: 'dayBefore',
        label: '前日の準備を頼む',
        detail: '茅運びと足場を、前の日に半日だけ',
        when: knows('isuke.availability', 'dayBefore'),
      },
    ],
  },
  {
    id: 'offer',
    label: 'サエ家からの申し出',
    options: [
      { id: 'none', label: 'なし' },
      {
        id: 'harvestHelp',
        label: '伊助家の刈り入れに人を出す',
        detail: 'サエ家も楽ではないが、頼むだけにしない',
        when: knows('isuke.field', 'progress'),
      },
    ],
  },
];

/** 作業台を使えるようになる条件（サエから日取りの話を聞いた後）。 */
export const PLANNING_AVAILABLE: Condition = knows('sae.schedule');

/** 最初に作業台に広げる案（サエが考えていた「予定日に伊助に当日来てもらう」）。 */
export const INITIAL_PLAN: PlanSpec = { date: 'keep', isuke: 'dayOf', offer: 'none' };

function respond(npc: NpcId, plan: PlanSpec): PlanRule {
  const { date, isuke, offer } = plan;
  const helps = offer === 'harvestHelp';
  if (npc === 'isuke') {
    if (date === 'keep' && isuke === 'dayOf') return { status: 'declined', reason: 'harvestConflict' };
    if (date === 'keep' && isuke === 'dayBefore') {
      return helps ? { status: 'agreed', reason: 'prepWithHelp' } : { status: 'conditional', reason: 'needsCover' };
    }
    if (date === 'afterHarvest' && isuke === 'dayOf') {
      return { status: 'agreed', reason: helps ? 'afterHarvestHelp' : 'afterHarvest' };
    }
    if (date === 'afterHarvest' && isuke === 'dayBefore') return { status: 'agreed', reason: 'onlyDayBefore' };
    throw new Error(`伊助に相談しない案です：${JSON.stringify(plan)}`);
  }
  if (npc === 'sae') {
    if (date === 'afterHarvest' && isuke !== 'dayOf') return { status: 'declined', reason: 'pointlessDelay' };
    if (date === 'afterHarvest') return { status: 'agreed', reason: helps ? 'delayWithReturn' : 'delayWorry' };
    if (isuke === 'none') return { status: 'agreed', reason: 'noIsuke' };
    return { status: 'agreed', reason: helps ? 'withReturn' : 'reliesOnIsuke' };
  }
  throw new Error(`計画に関係しない住民です：${npc}`);
}

function outcome(plan: PlanSpec): string | null {
  const { date, isuke, offer } = plan;
  if (date === 'keep' && isuke === 'none' && offer === 'none') return 'r1';
  if (date === 'keep' && isuke === 'dayBefore' && offer === 'harvestHelp') return 'r2';
  if (date === 'afterHarvest' && isuke === 'dayOf') return offer === 'harvestHelp' ? 'r3help' : 'r3';
  return null;
}

const OUTCOME_EFFECTS: Readonly<Record<string, readonly Effect[]>> = {
  r1: [learn('sae.roof', 'renewed'), setFlag('roofing:done')],
  r2: [
    learn('sae.roof', 'renewed'),
    setConsent('isuke', 'roofPrep', 'agreed', '刈り入れを手伝ってもらう約束で'),
    {
      type: 'recordPromise',
      id: 'saeHelpsIsukeHarvest',
      from: 'sae',
      to: 'isuke',
      content: '伊助家の刈り入れに人手を出す（屋根葺きの前日に、伊助が畑を離れた分）',
    },
    setFlag('roofing:done'),
  ],
  r3: [
    learn('sae.roof', 'worse'),
    learn('sae.roof', 'renewed'),
    setConsent('isuke', 'roofDay', 'agreed', '刈り入れの後の日程で'),
    setFlag('roofing:done'),
  ],
  r3help: [
    learn('sae.roof', 'worse'),
    learn('sae.roof', 'renewed'),
    setConsent('isuke', 'roofDay', 'agreed', '刈り入れの後の日程で'),
    setFlag('roofing:done'),
  ],
};

export const PLANNING: PlanningDefs = {
  items: PLAN_ITEMS,
  invalidReason(plan) {
    if (plan.isuke === 'none' && plan.offer === 'harvestHelp') {
      return '刈り入れの手伝いを申し出るなら、伊助にも相談する案にする必要がある。';
    }
    return null;
  },
  involved(plan) {
    return plan.isuke === 'none' ? ['sae'] : ['sae', 'isuke'];
  },
  respond,
  outcome,
  outcomeEffects: (id) => OUTCOME_EFFECTS[id] ?? [],
};

/** 作業台・手帳に出す、返事の要旨。 */
export const RESPONSE_SUMMARY: Readonly<Record<string, string>> = {
  harvestConflict: '屋根葺きの日は刈り入れと重なる',
  needsCover: '前日の半日でも刈り入れが遅れる。その分をどうするか次第',
  prepWithHelp: '刈り入れを手伝ってもらえるなら、前日の半日は出られる',
  afterHarvest: '刈り入れの後なら当日から出られる',
  afterHarvestHelp: '刈り入れの後なら出られる。手伝ってもらえれば早く片づく',
  onlyDayBefore: '刈り入れの後で前日だけなら出られる',
  noIsuke: '伊助さんに無理を言わずに済む。人手は少ないがなんとかする',
  reliesOnIsuke: 'また伊助さんに頼ることになるのが気がかり',
  withReturn: '頼むだけでなく、うちからも人を出す',
  pointlessDelay: '伊助さんが当日来られないのに延ばせば、その間に屋根が傷む',
  delayWorry: '延ばせば屋根の傷みが進むのは心配。それでも伊助さんが来られるなら',
  delayWithReturn: '延ばすのは心配。待つあいだ、伊助さんの刈り入れを手伝う',
};

// ───────── 結果 ─────────

export interface OutcomeLine {
  readonly text: string;
  /** その情報を知っていたときだけ出す文（知らずに決めたことも結果に表れる）。 */
  readonly when?: Condition;
}

export interface OutcomeDef {
  readonly id: string;
  readonly title: string;
  /** いつのことか（結果画面の見出し）。 */
  readonly when: string;
  readonly story: readonly OutcomeLine[];
  /** 何が変わったか（点数ではなく具体的な変化）。 */
  readonly changes: ReadonlyArray<{ readonly label: string; readonly text: string }>;
  /** 結帳に書き加えられる記録。 */
  readonly ledger: LedgerEntry;
}

const village = (detail: string): LedgerEntry['items'][number] => ({
  id: 'L3-village',
  from: 'village',
  to: 'sae',
  kind: 'labor',
  detail,
  settlement: 'open',
  settlementNote: 'それぞれの家の屋根葺きの折に返す。',
});

export const OUTCOMES: Readonly<Record<string, OutcomeDef>> = {
  r1: {
    id: 'r1',
    title: '少ない人手で、予定どおりに',
    when: '屋根葺きの日',
    story: [
      { text: '予定どおりの日、サエ家の屋根葺きが始まった。伊助さんには頼まず、サエ家の人たちと手の空いた村の人たちで茅を運び、屋根に上った。' },
      { text: '人手が足りず、葺き終わるまでに二日かかった。日が暮れるまで縄を締める音が続いた。' },
      {
        text: '伊助さんは、その二日間も畑で稲を刈っていた。屋根の方を一度だけ見上げて、また鎌を動かしていたという。',
        when: knows('isuke.availability', 'harvest'),
      },
      {
        text: '伊助さんがなぜ断ったのか、結局聞けずじまいだった。',
        when: all(knows('isuke.availability'), { topic: 'isuke.availability', below: 'harvest' }),
      },
      { text: '伊助さんには、最後まで声をかけなかった。', when: { topic: 'isuke.availability', below: 'declined' } },
      {
        text: '「伊助さんに無理をさせずに済んだ」とサエさんは言った。ただ、十二年前の手伝いの返しは、結帳に「まだ」のまま残っている。',
        when: knows('sae.dateReason', 'burden'),
      },
    ],
    changes: [
      { label: '屋根', text: '予定日に葺き替えた（人手が少なく二日がかり）' },
      { label: '伊助', text: '関わっていない。刈り入れは予定どおり続いた' },
      { label: 'サエ家', text: '新しい約束はない。十二年前の返しは残ったまま' },
      { label: '結帳', text: '村の人たちの手伝いが記された' },
    ],
    ledger: {
      id: 'L3',
      when: '今年の秋',
      title: 'サエ家 屋根葺き（南面）',
      items: [village('数人・二日（サエ家の人たちとともに）')],
      relatedTopics: ['sae.roof', 'isuke.availability', 'sae.dateReason'],
    },
  },
  r2: {
    id: 'r2',
    title: '前日の準備を分け合って',
    when: '屋根葺きの前日と当日',
    story: [
      { text: '屋根葺きの前の日、伊助さんが半日だけ畑を離れ、茅を運び、足場を組むのを手伝ってくれた。' },
      { text: 'おかげで当日は段取りよく進み、屋根は一日で葺き上がった。' },
      { text: 'その代わり、サエ家からは伊助家の刈り入れに人を出すことになった。サエ家にとっても、楽な約束ではない。' },
      {
        text: '結帳には、十二年前の「まだ」の記録の後に、新しい約束が書き加えられた。',
        when: knows('isuke.pastHelp'),
      },
    ],
    changes: [
      { label: '屋根', text: '予定日に、一日で葺き替えた' },
      { label: '伊助', text: '前日の半日を手伝った。刈り入れは半日遅れた' },
      { label: 'サエ家', text: '伊助家の刈り入れを手伝う約束が残った' },
      { label: '結帳', text: '伊助家の前日の手伝い（返しはまだ）と、新しい約束が記された' },
    ],
    ledger: {
      id: 'L3',
      when: '今年の秋',
      title: 'サエ家 屋根葺き（南面）',
      items: [
        village('数人・一日'),
        {
          id: 'L3-isuke',
          from: 'isuke',
          to: 'sae',
          kind: 'labor',
          detail: '一人・前日の半日（茅運び、足場）',
          settlement: 'open',
          settlementNote: 'まだ。サエ家は伊助家の刈り入れに人を出すと約束した。',
        },
      ],
      relatedTopics: ['sae.roof', 'isuke.availability', 'isuke.field'],
    },
  },
  r3: {
    id: 'r3',
    title: '刈り入れを待って',
    when: '十日後',
    story: [
      { text: '屋根葺きは、伊助さんの刈り入れが済むまで延ばされた。' },
      { text: '待つあいだに雨の日が続き、屋根の傷みは思った以上に広がっていた。葺き替えの手間は増えた。' },
      { text: 'それでも当日は伊助さんも朝から屋根に上がり、人手のそろった作業になった。' },
      { text: 'サエさんは喜びながらも、「また伊助さんに頼ってしまった」と小さく言った。', when: knows('sae.dateReason', 'burden') },
    ],
    changes: [
      { label: '屋根', text: '十日後に葺き替えた。傷みが広がった分、手間が増えた' },
      { label: '伊助', text: '刈り入れの後、当日の作業に加わった' },
      { label: 'サエ家', text: '伊助家への返しが、十二年前の分に加えて増えた' },
      { label: '結帳', text: '伊助家の当日の手伝い（返しはまだ）が記された' },
    ],
    ledger: {
      id: 'L3',
      when: '今年の秋（刈り入れの後）',
      title: 'サエ家 屋根葺き（南面）',
      items: [
        village('数人・一日（傷みが広がり手間が増えた）'),
        {
          id: 'L3-isuke',
          from: 'isuke',
          to: 'sae',
          kind: 'labor',
          detail: '一人・一日（屋根の上）',
          settlement: 'open',
          settlementNote: 'まだ返していない。伊助家の屋根葺きの折に返す。',
        },
      ],
      relatedTopics: ['sae.roof', 'isuke.availability', 'isuke.pastHelp'],
    },
  },
  r3help: {
    id: 'r3help',
    title: '刈り入れを手伝い、待って',
    when: '七日後',
    story: [
      { text: 'サエ家から人を出して、伊助さんの刈り入れを手伝った。人手が増えた分、刈り入れは早く片づいた。' },
      { text: '屋根葺きは七日後。待つあいだに傷みは少し進んだが、伊助さんも当日の作業に加わった。' },
      { text: 'サエ家は自分の屋根を待ちながら、よその田に人を出した。楽な七日間ではなかった。' },
      {
        text: '結帳には、サエ家が出した手と、伊助家が出した手が、並んで書きつけられた。どう釣り合うのかは、どこにも書かれていない。',
        when: knows('ledger.basics'),
      },
    ],
    changes: [
      { label: '屋根', text: '七日後に葺き替えた。傷みは少し進んだ' },
      { label: '伊助', text: '刈り入れが早く済み、当日の作業に加わった' },
      { label: 'サエ家', text: '待つあいだに伊助家の刈り入れを手伝った' },
      { label: '結帳', text: 'サエ家の刈り入れの手伝いと、伊助家の当日の手伝いが並んで記された' },
    ],
    ledger: {
      id: 'L3',
      when: '今年の秋（刈り入れの後）',
      title: 'サエ家 屋根葺き（南面）と伊助家の刈り入れ',
      items: [
        {
          id: 'L3-sae',
          from: 'sae',
          to: 'isuke',
          kind: 'labor',
          detail: '一人・三日（刈り入れ）',
          settlement: 'none',
          settlementNote: '屋根葺きを待つあいだに手伝った。返しの取り決めは記されていない。',
        },
        village('数人・一日'),
        {
          id: 'L3-isuke',
          from: 'isuke',
          to: 'sae',
          kind: 'labor',
          detail: '一人・一日（屋根の上）',
          settlement: 'none',
          settlementNote: '刈り入れの手伝いと同じ秋のこと。返しの取り決めは記されていない。',
        },
      ],
      relatedTopics: ['sae.roof', 'isuke.availability', 'isuke.pastHelp'],
    },
  },
};
