import {
  all,
  any,
  evaluate,
  knows,
  learn,
  setConsent,
  setFlag,
  type Condition,
  type Effect,
  type StoryQuery,
} from '../story/conditions';
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

/** 作業台で「この案に関わる事情」として出す情報（項目 → 選んだ選択肢 → 情報）。 */
export const RELEVANT_TOPICS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  date: { keep: ['sae.dateReason', 'sae.roof'], afterHarvest: ['sae.roof', 'sae.dateReason', 'isuke.field'] },
  isuke: {
    none: ['isuke.pastHelp'],
    dayOf: ['isuke.availability', 'isuke.pastHelp'],
    dayBefore: ['isuke.availability', 'isuke.field'],
  },
  offer: { none: [], harvestHelp: ['isuke.field', 'sae.dateReason'] },
};

// ───────── 見込み（作業台で、決める前に見せる） ─────────

export interface ForecastLine {
  /** 観点（屋根／伊助の刈り入れ／サエ家が負うこと／伊助の関わり）。 */
  readonly aspect: string;
  readonly text: string;
  /** 情報が足りず、見通せない部分がある。 */
  readonly uncertain: boolean;
}

/**
 * その案で起きることの見込み。案の内容から決まり、**知っている情報の分だけ**見通せる。
 * 点数や記号にせず、文章で示す（何を大切にするかはプレイヤーが決める）。
 * docs/PHASE3_5_IMPROVEMENT.md「C」。
 */
export function forecastPlan(plan: PlanSpec, q: StoryQuery): ForecastLine[] {
  if (PLANNING.invalidReason(plan) !== null) return [];
  const { date, isuke, offer } = plan;
  const helps = offer === 'harvestHelp';
  const k = (c: Condition) => evaluate(c, q);
  const knowsRoof = k(any(knows('sae.roof'), knows('sae.dateReason', 'roofWorry')));
  const knowsHarvest = k(knows('isuke.availability', 'harvest'));
  const knowsProgress = k(knows('isuke.field', 'progress'));
  const knowsPast = k(knows('isuke.pastHelp'));
  const knowsBurden = k(knows('sae.dateReason', 'burden'));
  const line = (aspect: string, text: string, uncertain = false): ForecastLine => ({ aspect, text, uncertain });
  const lines: ForecastLine[] = [];

  // 屋根
  if (date === 'keep') {
    lines.push(
      line(
        '屋根',
        isuke === 'none'
          ? '予定日に葺く。人手が少なく、二日がかりになる'
          : isuke === 'dayBefore'
            ? '予定日に、一日で葺ける（前日に準備が済むため）'
            : '予定日に葺く（伊助が来られれば一日で済む）',
      ),
    );
  } else {
    const when = knowsProgress
      ? helps
        ? '七日ほど先に葺く（刈り入れが早く済むため）。'
        : '十日ほど先に葺く。'
      : '刈り入れが済むまで待つ（いつ済むかは、畑の様子をよく知らないので分からない）。';
    const damage = knowsRoof
      ? helps
        ? '待つあいだに、傷みは少し進む'
        : '待つあいだに傷みが広がり、手間と茅が余計に要る'
      : '待つあいだ屋根がどうなるかは、まだ分からない（屋根をよく見ていない）';
    lines.push(line('屋根', when + damage, !knowsProgress || !knowsRoof));
  }

  // 伊助の刈り入れ
  if (isuke === 'none') lines.push(line('伊助の刈り入れ', '今までどおり続けられる'));
  else if (date === 'keep' && isuke === 'dayOf') {
    lines.push(
      knowsHarvest
        ? line('伊助の刈り入れ', '屋根葺きの日と重なる。伊助は来られない')
        : line('伊助の刈り入れ', '伊助の都合は分からない（断られた理由を知らない）', true),
    );
  } else if (date === 'keep' && isuke === 'dayBefore') {
    lines.push(
      line(
        '伊助の刈り入れ',
        '前日の半日、刈り入れが止まる。天気が崩れれば、稲が傷む恐れがある' + (helps ? '。遅れはサエ家の手で取り戻す' : ''),
      ),
    );
  } else {
    lines.push(line('伊助の刈り入れ', helps ? 'サエ家の手が加わり、早く済む' : '刈り入れを先に済ませられる'));
  }

  // サエ家が負うこと
  const past = knowsPast ? '十二年前の返しも、まだ残っている' : '';
  if (isuke === 'none') {
    lines.push(line('サエ家が負うこと', ['新しい約束は増えない', past].filter(Boolean).join('。')));
  } else if (helps && date === 'keep') {
    lines.push(
      line(
        'サエ家が負うこと',
        ['屋根葺きのすぐ後、伊助家の刈り入れに人を出す約束が残る', knowsPast ? '十二年前の返しと約束が重なる' : '']
          .filter(Boolean)
          .join('。'),
      ),
    );
  } else if (helps) {
    lines.push(line('サエ家が負うこと', '自分の屋根を後回しにして、伊助家の田に人を出す（手伝いはその場で済む）'));
  } else {
    lines.push(
      line(
        'サエ家が負うこと',
        ['伊助にまた手を借り、返しが増える', past, knowsBurden ? 'サエはそれを気に病んでいる' : ''].filter(Boolean).join('。'),
      ),
    );
  }

  // 伊助の関わり
  lines.push(
    line(
      '伊助の関わり',
      isuke === 'none'
        ? '今回の屋根葺きには加わらない'
        : isuke === 'dayBefore'
          ? '前日の準備に加わる'
          : date === 'keep'
            ? '当日に来てもらう（都合がつけば）'
            : '刈り入れの後、当日に屋根へ上がる',
    ),
  );
  return lines;
}

// ───────── 結果 ─────────

export interface OutcomeLine {
  readonly text: string;
  /** その情報を知っていたときだけ出す文（知らずに決めたことも結果に表れる）。 */
  readonly when?: Condition;
}

/** 結果の後の村での立ち位置（住民が結果に応じた場所にいる）。 */
export interface Placement {
  readonly position: { readonly x: number; readonly z: number };
  readonly heading: number;
}

export interface OutcomeDef {
  readonly id: string;
  readonly title: string;
  /** 一行の要約（「選ばなかった案」などで使う）。 */
  readonly tagline: string;
  /** いつのことか（結果画面の見出し）。 */
  readonly when: string;
  /** 短い情景（2〜3文）。 */
  readonly story: readonly OutcomeLine[];
  /** その判断によって実現したこと。 */
  readonly achieved: readonly OutcomeLine[];
  /** その代わりに残った負担や約束。 */
  readonly costs: readonly OutcomeLine[];
  /** 結帳に書き加えられる記録。 */
  readonly ledger: LedgerEntry;
  /** 結果の後、いつもと違う場所にいる住民（人物 ID → 立ち位置）。 */
  readonly placements: Readonly<Record<string, Placement>>;
  /** 伊助家の刈り入れが済み、はさ掛けに稲がすべて掛かっているか。 */
  readonly harvestDone: boolean;
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

/** 伊助が刈り入れを済ませてサエ家の前に来ている（R3・R3'）。 */
const ISUKE_AT_SAE: Placement = { position: { x: -2.9, z: 12.0 }, heading: 1.79 };
/** サエが伊助の畑で刈り入れを手伝っている（R2）。 */
const SAE_AT_FIELD: Placement = { position: { x: 37.0, z: 10.6 }, heading: Math.PI };

export const OUTCOMES: Readonly<Record<string, OutcomeDef>> = {
  r1: {
    id: 'r1',
    title: '少ない人手で、予定どおりに',
    tagline: '伊助に頼まず、予定日に二日がかりで葺く',
    when: '屋根葺きの日',
    story: [
      { text: '伊助さんには頼まず、サエ家の人たちと手の空いた村の人たちで屋根に上った。人手が足りず、葺き終わるまでに二日かかった。' },
      {
        text: 'そのあいだも、伊助さんは畑で稲を刈っていた。',
        when: knows('isuke.availability', 'harvest'),
      },
      {
        text: '伊助さんがなぜ断ったのか、結局聞けずじまいだった。',
        when: all(knows('isuke.availability'), { topic: 'isuke.availability', below: 'harvest' }),
      },
      { text: '伊助さんには、最後まで声をかけなかった。', when: { topic: 'isuke.availability', below: 'declined' } },
    ],
    achieved: [
      { text: '屋根は予定日に葺き替えた' },
      { text: '伊助の刈り入れは、何も止めずに済んだ' },
      { text: 'サエ家に新しい約束は増えなかった' },
    ],
    costs: [
      { text: '人手が足りず、二日がかりになった（サエ家の人たちは疲れ切った）' },
      { text: '伊助は今回の屋根葺きに加わらなかった' },
      { text: '十二年前の伊助家への返しは、まだ残っている', when: knows('isuke.pastHelp') },
    ],
    ledger: {
      id: 'L3',
      when: '今年の秋',
      title: 'サエ家 屋根葺き（南面）',
      items: [village('数人・二日（サエ家の人たちとともに）')],
      relatedTopics: ['sae.roof', 'isuke.availability', 'sae.dateReason'],
    },
    placements: {},
    harvestDone: false,
  },
  r2: {
    id: 'r2',
    title: '前日の準備を分け合って',
    tagline: '伊助に前日の準備を頼み、刈り入れを手伝う約束をする',
    when: '屋根葺きの前日と当日',
    story: [
      { text: '前の日、伊助さんが半日だけ畑を離れ、茅を運び、足場を組んでくれた。当日は段取りよく進み、屋根は一日で葺き上がった。' },
      { text: '屋根葺きの翌日から、サエ家の人が伊助さんの田に出ている。' },
    ],
    achieved: [
      { text: '屋根は予定日に、一日で葺き替えた' },
      { text: '伊助も前日の準備に加わった' },
    ],
    costs: [
      { text: '伊助の刈り入れは半日止まった（天気がもってくれた）' },
      { text: 'サエ家は、屋根葺きのすぐ後に伊助家の刈り入れを手伝う約束を負った' },
      { text: '十二年前の返しも残ったまま、新しい約束が重なった', when: knows('isuke.pastHelp') },
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
    placements: { sae: SAE_AT_FIELD },
    harvestDone: false,
  },
  r3: {
    id: 'r3',
    title: '刈り入れを待って',
    tagline: '刈り入れの後に延ばし、伊助に当日来てもらう',
    when: '十日後',
    story: [
      { text: '屋根葺きは、伊助さんの刈り入れが済むまで延ばされた。待つあいだに雨の日が続き、屋根の傷みは思った以上に広がっていた。' },
      { text: '当日は伊助さんも朝から屋根に上がり、人手のそろった作業になった。' },
    ],
    achieved: [
      { text: '伊助も当日の作業に加わり、人手がそろった' },
      { text: '伊助の刈り入れは、何も止めずに済んだ' },
    ],
    costs: [
      { text: '十日待つあいだに傷みが広がり、葺き替えの手間と茅が余計にかかった' },
      { text: 'サエ家は伊助家への返しを、さらに一つ負った' },
      { text: 'サエは「また伊助さんに頼ってしまった」と気に病んでいる', when: knows('sae.dateReason', 'burden') },
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
    placements: { isuke: ISUKE_AT_SAE },
    harvestDone: true,
  },
  r3help: {
    id: 'r3help',
    title: '刈り入れを手伝い、待って',
    tagline: '先に伊助家の刈り入れを手伝い、その後で葺く',
    when: '七日後',
    story: [
      { text: 'サエ家から人を出して、伊助さんの刈り入れを手伝った。刈り入れは早く片づき、屋根葺きは七日後になった。' },
      { text: '当日は伊助さんも屋根に上がった。' },
    ],
    achieved: [
      { text: '伊助も当日の作業に加わり、人手がそろった' },
      { text: '伊助家の刈り入れが早く済んだ' },
      { text: 'サエ家の手伝いは、その場で果たした（約束は残っていない）' },
    ],
    costs: [
      { text: '七日待つあいだに、屋根の傷みは少し進んだ' },
      { text: 'サエ家は自分の屋根を後回しにして、よその田に人を出した' },
      { text: '互いに出した手がどう釣り合うのかは、結帳にも書かれていない', when: knows('ledger.basics') },
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
    placements: { isuke: ISUKE_AT_SAE },
    harvestDone: true,
  },
};
