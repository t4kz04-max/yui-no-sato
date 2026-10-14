import {
  all,
  any,
  evaluate,
  knows,
  learn,
  setChapter,
  setConsent,
  setFlag,
  type Condition,
  type Effect,
  type StoryQuery,
} from '../story/conditions';
import type { NpcId, PlanItemDef, PlanningDefs, PlanRule, PlanSpec } from '../story/types';
import type { LedgerEntry } from './ledger';

/**
 * 第1幕・第2幕の計画：サエ家の屋根葺き（docs/PHASE4_DESIGN.md §2〜§6）。
 *
 * - 返事・結果は「今の事情と提案内容」だけで決まる純粋関数。過去の貸し借り（結帳）・会話の回数・
 *   好感度は入力にしない（過去の協力と現在の同意を混同しない）。
 * - 宗平の別件（村の茅場の茅刈り）、ミネが茅刈りを仕切れば茅の当てがつくこと、は本書の暫定設定（🔶）。
 * - すべてゲーム用の仮設定。
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
  {
    id: 'kaya',
    label: '茅',
    options: [
      { id: 'mine', label: 'ミネ家から借りる', detail: '南面をすべて葺き直せる' },
      {
        id: 'own',
        label: 'サエ家の手持ちだけで葺く',
        detail: '傷みのひどい所だけ。残りは持ち越し',
        when: knows('sae.kaya'),
      },
    ],
  },
  {
    id: 'kayaReturn',
    label: 'ミネへの返し方',
    visibleWhen: (p) => p.kaya === 'mine',
    options: [
      { id: 'none', label: '（借りない）', hidden: true },
      { id: 'labor', label: '手伝いで返す', detail: 'ミネ家の仕事に人を出す' },
      {
        id: 'nextYear',
        label: '来年の秋、同じ束数の茅で返す',
        detail: '口約束',
        when: knows('mine.kaya', 'returnTerms'),
      },
      {
        id: 'nextYearRecorded',
        label: '来年の秋、茅で返すと結帳に記す',
        detail: 'いつ・何で返すかを書き残す',
        when: knows('mine.kaya', 'whyRecord'),
      },
    ],
  },
  {
    id: 'soheiCover',
    label: '宗平の別件（茅刈りの段取り）',
    visibleWhen: (p) => p.date === 'afterHarvest',
    options: [
      { id: 'none', label: 'そのまま', detail: '宗平は茅刈りに出る' },
      {
        id: 'mineCovers',
        label: 'ミネに茅刈りの段取りを頼む',
        detail: '宗平が屋根葺きに来られるようにする',
        when: knows('sohei.schedule', 'kayaCutting'),
      },
    ],
  },
];

/** 作業台を使えるようになる条件（サエから日取りの話を聞いた後）。 */
export const PLANNING_AVAILABLE: Condition = knows('sae.schedule');

/** 最初に作業台に広げる案（サエと主人公が最初に思いつく素朴な案）。 */
export const INITIAL_PLAN: PlanSpec = {
  date: 'keep',
  isuke: 'dayOf',
  offer: 'none',
  kaya: 'mine',
  kayaReturn: 'labor',
  soheiCover: 'none',
};

/** 項目どうしの依存を整える。 */
function normalize(plan: PlanSpec): PlanSpec {
  const p = { ...plan } as Record<string, string>;
  if (p.kaya === 'own') p.kayaReturn = 'none';
  else if (p.kayaReturn === 'none') p.kayaReturn = 'labor';
  if (p.date === 'keep') p.soheiCover = 'none';
  return p;
}

function respond(npc: NpcId, plan: PlanSpec): PlanRule {
  const { date, isuke, offer, kaya, kayaReturn, soheiCover } = plan;
  const helps = offer === 'harvestHelp';
  const delayed = date === 'afterHarvest';
  const covered = soheiCover === 'mineCovers';
  switch (npc) {
    case 'isuke':
      if (!delayed && isuke === 'dayOf') return { status: 'declined', reason: 'harvestConflict' };
      if (!delayed && isuke === 'dayBefore') {
        return helps ? { status: 'agreed', reason: 'prepWithHelp' } : { status: 'conditional', reason: 'needsCover' };
      }
      if (delayed && isuke === 'dayOf') return { status: 'agreed', reason: helps ? 'afterHarvestHelp' : 'afterHarvest' };
      if (delayed && isuke === 'dayBefore') return { status: 'agreed', reason: 'onlyDayBefore' };
      break;
    case 'sae':
      if (delayed && isuke !== 'dayOf') return { status: 'declined', reason: 'pointlessDelay' };
      if (kaya === 'own') return { status: 'agreed', reason: 'partialRoof' };
      if (delayed) return { status: 'agreed', reason: helps ? 'delayWithReturn' : 'delayWorry' };
      if (isuke === 'none') return { status: 'agreed', reason: 'noIsuke' };
      return { status: 'agreed', reason: helps ? 'withReturn' : 'reliesOnIsuke' };
    case 'sohei':
      if (delayed && !covered) return { status: 'declined', reason: 'kayaCuttingDay' };
      if (delayed) return { status: 'agreed', reason: 'coveredByMine' };
      if (kaya === 'own') return { status: 'agreed', reason: 'partialOnly' };
      if (isuke === 'none') return { status: 'agreed', reason: 'fewHands' };
      if (isuke === 'dayBefore') return { status: 'agreed', reason: 'prepGood' };
      return { status: 'agreed', reason: 'soheiReady' };
    case 'mine':
      if (kaya === 'mine' && kayaReturn === 'labor') return { status: 'conditional', reason: 'wantsKaya' };
      if (kaya === 'mine' && kayaReturn === 'nextYear') return { status: 'conditional', reason: 'wantsRecord' };
      if (kaya === 'mine' && delayed && !covered) return { status: 'declined', reason: 'moreKaya' };
      if (kaya === 'mine' && delayed) return { status: 'agreed', reason: 'coverAndLend' };
      if (kaya === 'mine') return { status: 'agreed', reason: 'lendRecorded' };
      if (covered) return { status: 'agreed', reason: 'coverOnly' };
      break;
  }
  throw new Error(`この案で ${npc} に相談することはない：${JSON.stringify(plan)}`);
}

function involved(plan: PlanSpec): NpcId[] {
  const list: NpcId[] = ['sae', 'sohei'];
  if (plan.isuke !== 'none') list.push('isuke');
  if (plan.kaya === 'mine' || plan.soheiCover === 'mineCovers') list.push('mine');
  return list;
}

/** 結果の種類：誰が加わるか（family）と、茅の範囲（full／part）。 */
export type OutcomeFamily = 'solo' | 'prep' | 'wait' | 'waitHelp';

function outcome(plan: PlanSpec): string | null {
  const { date, isuke, offer, kaya, kayaReturn, soheiCover } = plan;
  if (kaya === 'mine' && kayaReturn !== 'nextYearRecorded') return null;
  const k = kaya === 'mine' ? 'full' : 'part';
  if (date === 'keep') {
    if (isuke === 'none' && offer === 'none') return `solo-${k}`;
    if (isuke === 'dayBefore' && offer === 'harvestHelp') return `prep-${k}`;
    return null;
  }
  if (isuke !== 'dayOf' || soheiCover !== 'mineCovers') return null;
  return `${offer === 'harvestHelp' ? 'waitHelp' : 'wait'}-${k}`;
}

export function parseOutcomeId(id: string): { family: OutcomeFamily; full: boolean } | null {
  const [family, k] = id.split('-');
  if (!['solo', 'prep', 'wait', 'waitHelp'].includes(family ?? '') || !['full', 'part'].includes(k ?? '')) return null;
  return { family: family as OutcomeFamily, full: k === 'full' };
}

function outcomeEffects(id: string): Effect[] {
  const o = parseOutcomeId(id);
  if (!o) return [];
  const effects: Effect[] = [];
  if (o.family === 'wait' || o.family === 'waitHelp') {
    effects.push(learn('sae.roof', 'worse'), setConsent('isuke', 'roofDay', 'agreed', '刈り入れの後の日程で'));
    effects.push(setConsent('mine', 'coverSohei', 'agreed', '宗平の代わりに茅刈りを仕切る'));
  }
  if (o.family === 'prep') {
    effects.push(setConsent('isuke', 'roofPrep', 'agreed', '刈り入れを手伝ってもらう約束で'), {
      type: 'recordPromise',
      id: 'saeHelpsIsukeHarvest',
      from: 'sae',
      to: 'isuke',
      content: '伊助家の刈り入れに人手を出す（屋根葺きの前日に、伊助が畑を離れた分）',
    });
  }
  if (o.full) {
    effects.push(setConsent('mine', 'lendKaya', 'agreed', '来年の秋に茅で返す（結帳に記す）'), {
      type: 'recordPromise',
      id: 'saeReturnsKaya',
      from: 'sae',
      to: 'mine',
      content: '来年の秋、借りた茅と同じ束数を茅で返す（結帳に記した）',
    });
  }
  // 葺き替えた（renewed／partial）という記録は、屋根葺きの日を終えたときに付ける（content/dialogues.ts の dayEnd。Phase 6）
  effects.push(setFlag('roofing:decided'), setChapter('roofDay'));
  return effects;
}

export const PLAN_ROOF: PlanningDefs = {
  id: 'roof',
  title: 'サエ家の屋根葺きの段取り',
  items: PLAN_ITEMS,
  normalize,
  invalidReason(plan) {
    if (plan.isuke === 'none' && plan.offer === 'harvestHelp') {
      return '刈り入れの手伝いを申し出るなら、伊助にも相談する案にする必要がある。';
    }
    return null;
  },
  involved,
  respond,
  outcome,
  outcomeEffects,
};

/** 作業台・手帳に出す、返事の要旨。 */
export const RESPONSE_SUMMARY: Readonly<Record<string, string>> = {
  // 伊助
  harvestConflict: '屋根葺きの日は刈り入れと重なる',
  needsCover: '前日の半日でも刈り入れが遅れる。その分をどうするか次第',
  prepWithHelp: '刈り入れを手伝ってもらえるなら、前日の半日は出られる',
  afterHarvest: '刈り入れの後なら当日から出られる',
  afterHarvestHelp: '刈り入れの後なら出られる。手伝ってもらえれば早く片づく',
  onlyDayBefore: '刈り入れの後で前日だけなら出られる',
  // サエ
  noIsuke: '伊助さんに無理を言わずに済む。人手は少ないがなんとかする',
  reliesOnIsuke: 'また伊助さんに頼ることになるのが気がかり',
  withReturn: '頼むだけでなく、うちからも人を出す',
  pointlessDelay: '伊助さんが当日来られないのに延ばせば、その間に屋根が傷む',
  delayWorry: '延ばせば屋根の傷みが進むのは心配。それでも伊助さんが来られるなら',
  delayWithReturn: '延ばすのは心配。待つあいだ、伊助さんの刈り入れを手伝う',
  partialRoof: '全部は葺けない。でも、借りを増やさずに済む',
  // 宗平
  kayaCuttingDay: 'その頃は茅場の茅刈りを仕切る役目がある',
  coveredByMine: 'ミネが茅刈りを見てくれるなら、屋根葺きに来られる',
  partialOnly: '茅が足りないなら、傷みのひどい所だけにする。残りは来年',
  fewHands: '人手が少ない。二日がかりになる',
  prepGood: '前の日に準備が済めば、当日は段取りよく進む',
  soheiReady: '予定日なら行ける。段取りは見る',
  // ミネ
  wantsKaya: 'うちが要るのは茅。手伝いで返されても困る',
  wantsRecord: '口約束では困る。書き残してほしい',
  moreKaya: '待てば傷みが広がって、もっと要る。今の蓄えでは足りない',
  coverAndLend: '茅刈りを仕切るなら新しい茅の当てがつく。それなら貸せる',
  lendRecorded: '来年の秋に茅で返すと書き残すなら、貸す',
  coverOnly: '茅刈りの段取りなら引き受ける',
};

/** 作業台で「この案に関わる事情」として出す情報（項目 → 選んだ選択肢 → 情報）。 */
export const RELEVANT_TOPICS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  date: { keep: ['sae.dateReason', 'sae.roof'], afterHarvest: ['sae.roof', 'sohei.schedule', 'isuke.field'] },
  isuke: {
    none: ['isuke.pastHelp'],
    dayOf: ['isuke.availability', 'isuke.pastHelp'],
    dayBefore: ['isuke.availability', 'isuke.field'],
  },
  offer: { none: [], harvestHelp: ['isuke.field', 'sae.dateReason'] },
  kaya: { mine: ['mine.kaya'], own: ['sae.kaya'] },
  kayaReturn: { none: [], labor: ['mine.kaya'], nextYear: ['mine.kaya'], nextYearRecorded: ['mine.kaya'] },
  soheiCover: { none: ['sohei.schedule'], mineCovers: ['sohei.schedule', 'mine.cutting'] },
};

// ───────── 見込み（作業台で、決める前に見せる） ─────────

export interface ForecastLine {
  /** 観点（屋根／伊助／段取りと茅／残る約束・負担）。 */
  readonly aspect: string;
  readonly text: string;
  /** 情報が足りず、見通せない部分がある。 */
  readonly uncertain: boolean;
}

/**
 * その案で起きることの見込み。案の内容から決まり、**知っている情報の分だけ**見通せる。
 * 点数や記号にせず、文章で示す（何を大切にするかはプレイヤーが決める）。
 */
export function forecastPlan(plan: PlanSpec, q: StoryQuery): ForecastLine[] {
  if (PLAN_ROOF.invalidReason(plan) !== null) return [];
  const { date, isuke, offer, kaya, kayaReturn, soheiCover } = plan;
  const helps = offer === 'harvestHelp';
  const delayed = date === 'afterHarvest';
  const k = (c: Condition) => evaluate(c, q);
  const knowsRoof = k(any(knows('sae.roof'), knows('sae.dateReason', 'roofWorry')));
  const knowsHarvest = k(knows('isuke.availability', 'harvest'));
  const knowsProgress = k(knows('isuke.field', 'progress'));
  const knowsPast = k(knows('isuke.pastHelp'));
  const knowsKaya = k(knows('sae.kaya'));
  const knowsSoheiConflict = k(knows('sohei.schedule', 'kayaCutting'));
  const knowsMineCutting = k(knows('mine.cutting'));
  const line = (aspect: string, text: string, uncertain = false): ForecastLine => ({ aspect, text, uncertain });
  const lines: ForecastLine[] = [];

  // 屋根（いつ・どこまで）
  const scope =
    kaya === 'own'
      ? knowsKaya
        ? '手持ちの茅で、傷みのひどい所だけを葺く（残りは持ち越し）'
        : '手持ちの茅でどこまで葺けるかは分からない'
      : '南面をすべて葺き直す';
  if (!delayed) {
    const days = isuke === 'none' ? '人手が少なく二日がかり' : isuke === 'dayBefore' ? '前日に準備が済み、一日で済む' : '伊助が来られれば一日で済む';
    lines.push(line('屋根', `予定日に${scope}。${days}`, kaya === 'own' && !knowsKaya));
  } else {
    const when = knowsProgress ? (helps ? '七日ほど先' : '十日ほど先') : '刈り入れが済むまで（いつかは畑をよく見ないと分からない）';
    const damage = knowsRoof
      ? helps
        ? '待つあいだに傷みは少し進む'
        : '待つあいだに傷みが広がり、手間と茅が余計に要る'
      : '待つあいだ屋根がどうなるかは、まだ分からない';
    lines.push(line('屋根', `${when}に、${scope}。${damage}`, !knowsProgress || !knowsRoof || (kaya === 'own' && !knowsKaya)));
  }

  // 伊助
  if (isuke === 'none') lines.push(line('伊助', '刈り入れは今までどおり。今回の屋根葺きには加わらない'));
  else if (!delayed && isuke === 'dayOf') {
    lines.push(
      knowsHarvest
        ? line('伊助', '屋根葺きの日は刈り入れと重なる。来られない')
        : line('伊助', '伊助の都合は分からない（断られた理由を知らない）', true),
    );
  } else if (!delayed) {
    lines.push(line('伊助', '前日の半日、刈り入れが止まる。天気が崩れれば稲が傷む恐れ' + (helps ? '。遅れはサエ家の手で取り戻す' : '')));
  } else {
    lines.push(line('伊助', (helps ? 'サエ家の手で刈り入れが早く済み、' : '刈り入れを先に済ませ、') + '当日は屋根に上がる'));
  }

  // 段取りと茅（宗平・ミネ）
  const soheiPart = !delayed
    ? '宗平が段取りを見る'
    : soheiCover === 'mineCovers'
      ? 'ミネが茅刈りを代わり、宗平が屋根葺きに来る'
      : knowsSoheiConflict
        ? '宗平はその頃、茅場の茅刈りを仕切っていて来られない'
        : '延ばした日に宗平が来られるかは分からない';
  let minePart: string;
  if (kaya === 'mine') {
    minePart =
      kayaReturn === 'nextYearRecorded'
        ? delayed && soheiCover === 'mineCovers'
          ? knowsMineCutting
            ? 'ミネは茅刈りを仕切り、新しい茅の当てで今の茅を貸す（ミネの負担は大きい）'
            : 'ミネに茅刈りも茅も頼むことになる（ミネが応じるかは分からない）'
          : 'ミネから茅を借り、来年の秋に茅で返すと記す'
        : 'ミネから茅を借りる（返し方がミネの条件に合うかが鍵）';
  } else if (soheiCover === 'mineCovers') {
    minePart = 'ミネは茅刈りの段取りを引き受ける。茅は借りない';
  } else minePart = 'ミネからは借りない';
  lines.push(
    line(
      '段取りと茅',
      `${soheiPart}。${minePart}`,
      (delayed && soheiCover !== 'mineCovers' && !knowsSoheiConflict) || minePart.includes('分からない'),
    ),
  );

  // 残る約束・負担
  const owe: string[] = [];
  if (kaya === 'mine') owe.push('ミネ家に「来年の秋に茅で返す」約束');
  if (isuke === 'dayBefore' && helps) owe.push('屋根葺きのすぐ後に伊助家の刈り入れに人を出す約束');
  if (delayed && helps) owe.push('待つあいだ、自分の屋根を後回しにして伊助家の田に人を出す');
  if (isuke !== 'none' && !(isuke === 'dayBefore' && helps)) owe.push('伊助への返しが増える');
  if (delayed && soheiCover === 'mineCovers') owe.push('宗平はミネに借りができる');
  if (kaya === 'own') owe.push('屋根の残りは来年以降に持ち越し');
  if (knowsPast) owe.push('十二年前の伊助家への返しも残っている');
  lines.push(line('残る約束・負担', owe.length > 0 ? owe.join('。') : '新しい約束は増えない'));
  return lines;
}

// ───────── 要点（作業台で案を見比べるための短い項目。Phase 6） ─────────

export type GlanceKey = 'when' | 'scope' | 'who' | 'burden' | 'promises';

export interface GlanceLine {
  readonly key: GlanceKey;
  readonly label: string;
  readonly text: string;
  /** 情報が足りず、見通せない部分がある（見込みと同じ基準）。 */
  readonly uncertain: boolean;
}

export const GLANCE_LABEL: Record<GlanceKey, string> = {
  when: 'いつ',
  scope: '屋根をどこまで',
  who: '加わる人',
  burden: '負担が重くなる人',
  promises: '残る約束・返し',
};

/**
 * 案の要点。見込み（forecastPlan）と同じく、案の内容と**知っている情報の分だけ**から決まる。
 * 良し悪しの印は付けない（何を大切にするかはプレイヤーが決める）。
 */
export function glancePlan(plan: PlanSpec, q: StoryQuery): GlanceLine[] {
  if (PLAN_ROOF.invalidReason(plan) !== null) return [];
  const { date, isuke, offer, kaya, kayaReturn, soheiCover } = plan;
  const helps = offer === 'harvestHelp';
  const delayed = date === 'afterHarvest';
  const covered = soheiCover === 'mineCovers';
  const k = (c: Condition) => evaluate(c, q);
  const knowsRoof = k(any(knows('sae.roof'), knows('sae.dateReason', 'roofWorry')));
  const knowsHarvest = k(knows('isuke.availability', 'harvest'));
  const knowsProgress = k(knows('isuke.field', 'progress'));
  const knowsKaya = k(knows('sae.kaya'));
  const knowsSoheiConflict = k(knows('sohei.schedule', 'kayaCutting'));
  const g = (key: GlanceKey, text: string, uncertain = false): GlanceLine => ({ key, label: GLANCE_LABEL[key], text, uncertain });

  const when = !delayed
    ? isuke === 'none'
      ? ['予定日（人手が少なく二日がかり）', false]
      : ['予定日（一日）', false]
    : knowsProgress
      ? [`刈り入れの後（${helps ? '七日ほど先' : '十日ほど先'}）`, false]
      : ['刈り入れの後（いつになるかは分からない）', true];
  const scope =
    kaya === 'mine' ? ['南面をすべて', false] : knowsKaya ? ['傷みのひどい所だけ（残りは持ち越し）', false] : ['手持ちの茅で葺ける分（どこまでかは分からない）', true];

  const who: string[] = ['サエ家', '村の人'];
  let whoUncertain = false;
  if (!delayed || covered) who.push('宗平');
  else if (knowsSoheiConflict) who.push('宗平は来られない');
  else {
    who.push('宗平（来られるか分からない）');
    whoUncertain = true;
  }
  if (isuke === 'dayBefore') who.push('伊助（前日の準備）');
  else if (isuke === 'dayOf' && delayed) who.push('伊助');
  else if (isuke === 'dayOf') {
    if (knowsHarvest) who.push('伊助は来られない（刈り入れと重なる）');
    else {
      who.push('伊助（来られるか分からない）');
      whoUncertain = true;
    }
  }
  if (covered) who.push('ミネ（茅刈りを仕切る）');

  const burden: string[] = [];
  if (!delayed && isuke === 'none') burden.push('サエ家（人手が少なく二日がかり）');
  if (isuke === 'dayBefore') burden.push('伊助（刈り入れが半日止まる）');
  if (helps) burden.push(delayed ? 'サエ家（自分の屋根を後回しにして田に人を出す）' : 'サエ家（伊助家の刈り入れに人を出す）');
  if (delayed) burden.push(knowsRoof ? 'サエ家（待つあいだに屋根の傷みが進む）' : 'サエ家（待つあいだ屋根がどうなるかは分からない）');
  if (covered) burden.push('ミネ（茅刈りを仕切る大きな仕事）');
  const burdenUncertain = delayed && !knowsRoof;

  const promises: string[] = [];
  if (kaya === 'mine') promises.push(kayaReturn === 'nextYearRecorded' ? 'ミネ家に来年の秋、茅で返す（結帳に記す）' : 'ミネ家への返し方（ミネの条件に合うかが鍵）');
  if (isuke === 'dayBefore' && helps) promises.push('屋根葺きのすぐ後に、伊助家の刈り入れに人を出す');
  else if (isuke !== 'none') promises.push('伊助への返しが増える');
  if (covered) promises.push('宗平はミネに借りができる');

  return [
    g('when', when[0] as string, when[1] as boolean),
    g('scope', scope[0] as string, scope[1] as boolean),
    g('who', who.join('・'), whoUncertain),
    g('burden', burden.length > 0 ? burden.join('／') : '特に重くなる人はいない', burdenUncertain),
    g('promises', promises.length > 0 ? promises.join('／') : '新しい約束は増えない', kaya === 'mine' && kayaReturn !== 'nextYearRecorded'),
  ];
}

// ───────── 結果 ─────────

export interface OutcomeLine {
  readonly text: string;
  /** その情報を知っていたときだけ出す文（知らずに決めたことも結果に表れる）。 */
  readonly when?: Condition;
}

/** 屋根葺き当日の村での立ち位置（住民が計画に応じた場所にいる）。 */
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
  readonly story: readonly OutcomeLine[];
  readonly achieved: readonly OutcomeLine[];
  readonly costs: readonly OutcomeLine[];
  readonly ledger: LedgerEntry;
  /** 屋根葺き当日、いつもと違う場所にいる住民（人物 ID → 立ち位置）。 */
  readonly placements: Readonly<Record<string, Placement>>;
  /** 伊助家の刈り入れが済み、はさ掛けに稲がすべて掛かっているか。 */
  readonly harvestDone: boolean;
}

/** 屋根葺き当日、サエ家の前に来ている人の立ち位置。 */
export const ON_SITE: Readonly<Record<string, Placement>> = {
  // 段取り：梯子と屋根の方（北西）を向いて指示する
  sohei: { position: { x: -4.8, z: 10.6 }, heading: Math.PI + 0.35 },
  isuke: { position: { x: -2.9, z: 12.0 }, heading: 1.79 },
  mine: { position: { x: 8.2, z: 10.2 }, heading: -Math.PI / 2 },
};

// 屋根葺き当日に手伝いに来ている名前のない村の人たちは、Phase 5 で content/staging.ts に移した（役割・人数が計画で変わる）。

const FAMILY: Record<OutcomeFamily, { title: string; tagline: string; when: string }> = {
  solo: { title: '予定どおり、伊助に頼まずに', tagline: '予定日に、伊助に頼まず葺く', when: '屋根葺きの日' },
  prep: { title: '前日の準備を分け合って', tagline: '伊助に前日の準備を頼み、刈り入れを手伝う約束をする', when: '屋根葺きの前日と当日' },
  wait: { title: '刈り入れを待って', tagline: '刈り入れの後に延ばし、宗平の茅刈りをミネが代わる', when: '十日後' },
  waitHelp: { title: '刈り入れを手伝い、待って', tagline: '先に伊助家の刈り入れを手伝い、皆がそろう日に葺く', when: '七日後' },
};

function buildOutcome(id: string): OutcomeDef {
  const { family, full } = parseOutcomeId(id)!;
  const delayed = family === 'wait' || family === 'waitHelp';
  const story: OutcomeLine[] = [];
  const achieved: OutcomeLine[] = [];
  const costs: OutcomeLine[] = [];

  // 情景
  if (family === 'solo') story.push({ text: '伊助さんには頼まず、宗平さんの段取りで、サエ家の人たちと手の空いた村の人たちが屋根に上った。' });
  if (family === 'prep') story.push({ text: '前の日、伊助さんが半日だけ畑を離れ、茅を運び、足場を組んでくれた。当日は宗平さんの段取りで手際よく進んだ。' });
  if (family === 'wait') story.push({ text: '屋根葺きは刈り入れの後に延ばされた。ミネさんが茅場の茅刈りを仕切り、そのぶん宗平さんが屋根の段取りに来た。' });
  if (family === 'waitHelp') story.push({ text: 'サエ家が伊助さんの刈り入れを手伝い、刈り入れは早く片づいた。ミネさんが茅刈りを仕切り、宗平さんが屋根の段取りに来た。' });
  story.push({
    text: full
      ? 'ミネさんの茅で、南面はすべて新しくなった。'
      : '手持ちの茅で葺けたのは、傷みのひどい所だけだった。残りは来年以降に持ち越しになった。',
  });
  if (family === 'solo') {
    story.push({ text: 'そのあいだも、伊助さんは畑で稲を刈っていた。', when: knows('isuke.availability', 'harvest') });
    story.push({
      text: '伊助さんがなぜ断ったのか、結局聞けずじまいだった。',
      when: all(knows('isuke.availability'), { topic: 'isuke.availability', below: 'harvest' }),
    });
  }

  // 実現したこと
  achieved.push({ text: full ? '南面をすべて葺き替えた' : '傷みのひどい所を葺き替えた' });
  if (!delayed) achieved.push({ text: '予定日に葺けた（屋根の傷みを広げずに済んだ）' });
  if (family === 'prep') achieved.push({ text: '伊助も前日の準備に加わった' });
  if (delayed) achieved.push({ text: '伊助・宗平・ミネを含め、人手がそろった' });
  if (family === 'solo' || delayed) achieved.push({ text: '伊助の刈り入れは止めずに済んだ' });
  if (family === 'waitHelp') achieved.push({ text: 'サエ家の手伝いはその場で果たした' });
  if (!full) achieved.push({ text: 'ミネ家に新しい借りをつくらなかった' });

  // 残ったこと
  if (family === 'solo') {
    costs.push({ text: '人手が少なく二日がかりになった（サエ家の人たちは疲れ切った）' }, { text: '伊助は今回の屋根葺きに加わらなかった' });
  }
  if (family === 'prep') {
    costs.push(
      { text: '伊助の刈り入れは半日止まった（天気がもってくれた）' },
      { text: 'サエ家は、屋根葺きのすぐ後に伊助家の刈り入れを手伝う約束を負った' },
    );
  }
  if (delayed) {
    costs.push({ text: family === 'wait' ? '十日待つあいだに傷みが広がり、手間が余計にかかった' : '七日待つあいだに傷みが少し進んだ' });
    costs.push({ text: 'ミネは茅刈りを仕切る大きな仕事を引き受けた。宗平はミネに借りができた' });
    costs.push({ text: 'サエ家は伊助家への返しを、さらに一つ負った' });
  }
  if (family === 'waitHelp') costs.push({ text: 'サエ家は自分の屋根を後回しにして、よその田に人を出した' });
  costs.push(
    full
      ? { text: 'サエ家は、来年の秋にミネ家へ茅で返す約束を負った（結帳に記した）' }
      : { text: '屋根の残りは、来年以降にまた葺かなければならない' },
  );
  costs.push({ text: '十二年前の伊助家への返しは、まだ残っている', when: knows('isuke.pastHelp') });

  // 結帳
  const items: LedgerEntry['items'][number][] = [
    {
      id: 'L3-village',
      from: 'village',
      to: 'sae',
      kind: 'labor',
      detail: family === 'solo' ? '数人・二日' : '数人・一日',
      settlement: 'open',
      settlementNote: 'それぞれの家の屋根葺きの折に返す。',
    },
  ];
  if (family === 'prep') {
    items.push({
      id: 'L3-isuke',
      from: 'isuke',
      to: 'sae',
      kind: 'labor',
      detail: '一人・前日の半日（茅運び、足場）',
      settlement: 'open',
      settlementNote: 'まだ。サエ家は伊助家の刈り入れに人を出すと約束した。',
    });
  }
  if (delayed) {
    items.push({
      id: 'L3-isuke',
      from: 'isuke',
      to: 'sae',
      kind: 'labor',
      detail: '一人・一日（屋根の上）',
      settlement: family === 'waitHelp' ? 'none' : 'open',
      settlementNote:
        family === 'waitHelp' ? 'サエ家の刈り入れの手伝いと同じ秋のこと。返しの取り決めは記されていない。' : 'まだ返していない。伊助家の屋根葺きの折に返す。',
    });
    items.push({
      id: 'L3-sohei',
      from: 'sohei',
      to: 'sae',
      kind: 'labor',
      detail: '一人（屋根の上の段取り。茅刈りはミネが代わった）',
      settlement: 'open',
      settlementNote: 'まだ。宗平はミネに、茅刈りを代わってもらった借りがある。',
    });
  }
  if (family === 'waitHelp') {
    items.push({
      id: 'L3-sae',
      from: 'sae',
      to: 'isuke',
      kind: 'labor',
      detail: '一人・三日（刈り入れ）',
      settlement: 'none',
      settlementNote: '屋根葺きを待つあいだに手伝った。返しの取り決めは記されていない。',
    });
  }
  if (full) {
    items.push({
      id: 'L3-mine',
      from: 'mine',
      to: 'sae',
      kind: 'material',
      detail: delayed ? '茅（傷みが広がった分を含む）' : '茅（南面の分）',
      settlement: 'open',
      settlementNote: '来年の秋、同じ束数を茅で返す。（ここに記した）',
    });
  }

  const placements: Record<string, Placement> = { sohei: ON_SITE.sohei! };
  if (delayed) placements.isuke = ON_SITE.isuke!;
  if (full && !delayed) placements.mine = ON_SITE.mine!;

  const f = FAMILY[family];
  return {
    id,
    title: f.title + (full ? '' : '（手持ちの茅で）'),
    tagline: f.tagline + (full ? '（ミネの茅で）' : '（手持ちの茅で一部だけ）'),
    when: f.when,
    story,
    achieved,
    costs,
    ledger: {
      id: 'L3',
      when: delayed ? '今年の秋（刈り入れの後）' : '今年の秋',
      title: 'サエ家 屋根葺き（南面）',
      items,
      relatedTopics: ['sae.roof', 'isuke.availability', 'mine.kaya', 'sohei.schedule'],
    },
    placements,
    harvestDone: delayed,
  };
}

export const OUTCOME_IDS: readonly string[] = ['solo', 'prep', 'wait', 'waitHelp'].flatMap((f) => [`${f}-full`, `${f}-part`]);

export const OUTCOMES: Readonly<Record<string, OutcomeDef>> = Object.fromEntries(
  OUTCOME_IDS.map((id) => [id, buildOutcome(id)]),
);
