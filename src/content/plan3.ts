import { evaluate, knows, setChapter, setConsent, setFlag, type Condition, type Effect, type StoryQuery } from '../story/conditions';
import type { NpcId, PlanItemDef, PlanningDefs, PlanRule, PlanSpec } from '../story/types';
import { GLANCE_LABEL, type ForecastLine, type GlanceKey, type GlanceLine, type OutcomeLine } from './plan';
import { parseOutcomeId } from './plan';

/**
 * 第3幕「返す日」の計画：伊助家の屋根葺き（docs/PHASE4_DESIGN.md §8）。
 *
 * - 設計書 J：過去の記録に協力が残っていても、現在の状況では予定どおりに実行できない場合がある。
 *   記録を理由に、相手へ無条件の参加を強制することはできない。
 * - 三年後・サエが足を痛めている、は暫定設定（🔶）。
 * - 返事は今の事情と提案内容だけで決まる（第1幕の結果や結帳の記録では決まらない）。
 *
 * 設計書 J の選択との対応：
 * - Q1 事情を確認し、参加できる日や役割を相談し直す → 「サエ家に下の仕事を頼む」
 * - Q2 当初の約束どおりに協力を提案する → 「記録どおり、サエ家に屋根の上の仕事を頼む」（サエは断る）
 * - Q3 無理な約束はせず、相談を続ける → 「今年は見送る」
 */

export const PLAN3_ITEMS: readonly PlanItemDef[] = [
  {
    id: 'timing',
    label: '伊助家の屋根葺き',
    options: [
      { id: 'now', label: '今年の秋に葺く', detail: '伊助は今年のうちに葺きたい' },
      { id: 'nextYear', label: '今年は見送り、相談を続ける', detail: '屋根はもう一年もつ' },
    ],
  },
  {
    id: 'saeHelp',
    label: 'サエ家への頼み方',
    visibleWhen: (p) => p.timing === 'now',
    options: [
      { id: 'roofTop', label: '記録どおり、屋根の上の仕事を頼む', detail: '十五年前に伊助家がしてくれたのと同じ仕事' },
      {
        id: 'ground',
        label: '下の仕事（茅の受け渡し・片付け）を頼む',
        detail: '今のサエにできることを頼む',
        when: knows('sae.later', 'injured'),
      },
      { id: 'none', label: 'サエ家には頼まず、村の手で葺く', detail: '十五年前の返しは、また先に' },
    ],
  },
];

export const INITIAL_PLAN3: PlanSpec = { timing: 'now', saeHelp: 'roofTop' };

function normalize(plan: PlanSpec): PlanSpec {
  return plan.timing === 'nextYear' ? { ...plan, saeHelp: 'none' } : plan;
}

function involved(plan: PlanSpec): NpcId[] {
  return plan.timing === 'now' && plan.saeHelp !== 'none' ? ['isuke', 'sae'] : ['isuke'];
}

function respond(npc: NpcId, plan: PlanSpec): PlanRule {
  const { timing, saeHelp } = plan;
  if (npc === 'isuke') {
    if (timing === 'nextYear') return { status: 'agreed', reason: 'postpone' };
    if (saeHelp === 'roofTop') return { status: 'agreed', reason: 'asRecorded' };
    if (saeHelp === 'ground') return { status: 'agreed', reason: 'groundFine' };
    return { status: 'agreed', reason: 'withoutSae' };
  }
  if (npc === 'sae') {
    if (saeHelp === 'roofTop') return { status: 'declined', reason: 'injured' };
    if (saeHelp === 'ground') return { status: 'agreed', reason: 'groundOk' };
  }
  throw new Error(`この案で ${npc} に相談することはない：${JSON.stringify(plan)}`);
}

function outcome(plan: PlanSpec): string | null {
  if (plan.timing === 'nextYear') return 'e3';
  if (plan.saeHelp === 'ground') return 'e1';
  if (plan.saeHelp === 'none') return 'e2';
  return null;
}

function outcomeEffects(id: string): Effect[] {
  const effects: Effect[] = [setFlag(`ending:${id}`)];
  if (id === 'e1') effects.push(setConsent('sae', 'isukeRoofHelp', 'agreed', '屋根の下の仕事で'));
  if (id === 'e2') effects.push(setConsent('isuke', 'isukeRoofWithoutSae', 'agreed', 'サエ家には頼まずに葺く'));
  effects.push(setChapter('end'));
  return effects;
}

export const PLAN_ISUKE_ROOF: PlanningDefs = {
  id: 'isukeRoof',
  title: '伊助家の屋根葺きの段取り',
  items: PLAN3_ITEMS,
  normalize,
  invalidReason: () => null,
  involved,
  respond,
  outcome,
  outcomeEffects,
};

export const RESPONSE_SUMMARY3: Readonly<Record<string, string>> = {
  postpone: '屋根はもう一年もつ。急いで誰かに無理をさせることはない',
  asRecorded: '記録どおりに来てもらえるなら、ありがたい',
  groundFine: '屋根の上でなくても、手を貸してもらえるならありがたい',
  withoutSae: 'サエさんに無理はさせられん。村の手を借りて葺く',
  injured: '記録どおりにしたい。でも、この足では屋根に上がれない',
  groundOk: '下の仕事なら、この足でもできる',
};

export const RELEVANT_TOPICS3: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  timing: { now: ['isuke.roof3'], nextYear: ['isuke.roof3'] },
  saeHelp: { roofTop: ['isuke.pastHelp', 'sae.later'], ground: ['sae.later', 'isuke.pastHelp'], none: ['isuke.pastHelp'] },
};

/** 第3幕の見込み。 */
export function forecastPlan3(plan: PlanSpec, q: StoryQuery): ForecastLine[] {
  const k = (c: Condition) => evaluate(c, q);
  const injuredKnown = k(knows('sae.later', 'injured'));
  const line = (aspect: string, text: string, uncertain = false): ForecastLine => ({ aspect, text, uncertain });
  if (plan.timing === 'nextYear') {
    return [
      line('伊助家の屋根', '今年は葺かない。屋根はもう一年もつが、傷みは進む'),
      line('サエ', '今年は頼まない'),
      line('結帳の記録', '十五年前の「返しはまだ」は、そのまま残る'),
      line('これから', '来年に向けて、もう一度みんなで相談する'),
    ];
  }
  const sae =
    plan.saeHelp === 'roofTop'
      ? injuredKnown
        ? 'サエは足を痛めていて、屋根の上には上がれない'
        : 'サエが屋根の上の仕事を引き受けられるかは、まだ分からない'
      : plan.saeHelp === 'ground'
        ? '屋根の上ではなく、下で茅の受け渡しと片付けをする'
        : '今回は加わらない';
  const record =
    plan.saeHelp === 'none'
      ? '十五年前の返しは、まだ残る'
      : plan.saeHelp === 'ground'
        ? '十五年前と同じ仕事ではないが、本人どうしが納得すれば返しとして記す'
        : '記録どおりの返しになる';
  return [
    line('伊助家の屋根', '今年の秋に、村の人たちと葺く'),
    line('サエ', sae, plan.saeHelp === 'roofTop' && !injuredKnown),
    line('結帳の記録', record),
    line('これから', plan.saeHelp === 'none' ? 'サエ家は返す機会を、また待つことになる' : '伊助家とサエ家の行き来が、新しく記される'),
  ];
}

/** 第3幕の案を一文で表す（相談・決定の直前に出す。Phase 7・U05）。 */
export function planSentence3(plan: PlanSpec): string {
  if (plan.timing === 'nextYear') return '伊助家の屋根は今年は葺かず、来年に向けて相談を続ける。';
  const sae =
    plan.saeHelp === 'roofTop'
      ? 'サエ家には、記録どおり屋根の上の仕事を頼む'
      : plan.saeHelp === 'ground'
        ? 'サエ家には、下の仕事（茅の受け渡し・片付け）を頼む'
        : 'サエ家には頼まず、村の人たちの手で葺く';
  return `今年の秋に伊助家の屋根を葺く。${sae}。`;
}

/** 第3幕の案の要点（作業台で見比べる。知っている情報の分だけ見通せる）。 */
export function glancePlan3(plan: PlanSpec, q: StoryQuery): GlanceLine[] {
  const injuredKnown = evaluate(knows('sae.later', 'injured'), q);
  const g = (key: GlanceKey, text: string, uncertain = false): GlanceLine => ({ key, label: GLANCE_LABEL[key], text, uncertain });
  if (plan.timing === 'nextYear') {
    return [
      g('when', '今年は見送り（来年に向けて相談を続ける）'),
      g('scope', '伊助家の屋根は今年は葺かない（もう一年もつ）'),
      g('who', '—'),
      g('burden', '伊助家（屋根の傷みは進む）'),
      g('promises', '十五年前の返しは「まだ」のまま'),
    ];
  }
  const sae =
    plan.saeHelp === 'roofTop'
      ? injuredKnown
        ? ['サエ（屋根の上。ただし足を痛めていて上がれない）', false]
        : ['サエ（屋根の上。引き受けられるかは分からない）', true]
      : plan.saeHelp === 'ground'
        ? ['サエ（下で茅の受け渡しと片付け）', false]
        : ['サエ家は加わらない', false];
  return [
    g('when', '今年の秋'),
    g('scope', '伊助家の屋根を葺く'),
    g('who', `伊助家・村の人・${sae[0] as string}`, sae[1] as boolean),
    g(
      'burden',
      plan.saeHelp === 'roofTop' ? (injuredKnown ? 'サエ（痛めた足で屋根の上の仕事）' : 'サエ（屋根の上の仕事）') : '特に重くなる人はいない',
      plan.saeHelp === 'roofTop' && !injuredKnown,
    ),
    g(
      'promises',
      plan.saeHelp === 'none'
        ? '十五年前の返しは「まだ」のまま'
        : plan.saeHelp === 'ground'
          ? '本人どうしが納得すれば、十五年前の返しとして記す'
          : '記録どおりの返しになる',
    ),
  ];
}

// ───────── エンディング ─────────

export interface EndingDef {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly story: readonly OutcomeLine[];
  /** 振り返り（エンディング・選んだことの記録）：実現したこと。点数にはしない。 */
  readonly achieved: readonly OutcomeLine[];
  /** 振り返り：残ったこと・これからのこと。 */
  readonly remains: readonly OutcomeLine[];
}

const act1 = (...families: string[]): Condition => ({
  any: families.flatMap((f) => [{ outcome: [`${f}-full`] }, { outcome: [`${f}-part`] }]),
});
const act1Part: Condition = { any: ['solo', 'prep', 'wait', 'waitHelp'].map((f) => ({ outcome: [`${f}-part`] })) };
const act1Full: Condition = { any: ['solo', 'prep', 'wait', 'waitHelp'].map((f) => ({ outcome: [`${f}-full`] })) };

/** 第1幕の結果ごとに、三年のあいだにあったこと（第3幕の冒頭・エンディングで使う）。 */
export const MEANWHILE: readonly OutcomeLine[] = [
  { text: '三年前の秋、サエ家は約束どおり伊助家の刈り入れを手伝った。', when: act1('prep') },
  { text: '三年前の秋、伊助さんは刈り入れの後にサエ家の屋根に上がった。', when: act1('wait', 'waitHelp') },
  { text: '三年前の秋、伊助さんはサエ家の屋根葺きには加わらなかった。', when: act1('solo') },
  { text: 'ミネ家から借りた茅は、記したとおり翌年の秋に茅で返した。', when: act1Full },
  { text: 'サエ家の屋根の残りは、まだ葺き終わっていない。', when: act1Part },
];

export const ENDINGS: Readonly<Record<string, EndingDef>> = {
  e1: {
    id: 'e1',
    code: 'E1',
    title: 'つながる約束',
    story: [
      { text: '伊助家の屋根葺きの日。サエさんは屋根には上がれなかったが、下で茅を受け渡し、片付けを引き受けた。' },
      { text: '十五年前とは違う仕事だった。それでも伊助さんは「これで十分だ」と言い、二人で結帳に記した。' },
      { text: 'サエ家の屋根の残りを葺くときは、今度は伊助家が手を貸す。そう話がついた。', when: act1Part },
      { text: '結帳には、返しの記録と、これからの約束が並んだ。', when: act1Part },
      { text: '結帳の十五年前の記録の横に、「返し 済」と書き加えられた。', when: act1Full },
    ],
    achieved: [
      { text: '伊助家の屋根を、今年の秋に葺いた' },
      { text: 'サエ家は下の仕事を引き受け、十五年前の手伝いを返した（本人どうしで納得して結帳に記した）' },
      { text: 'サエに、足の痛む体で屋根に上がる無理をさせなかった' },
    ],
    remains: [
      { text: '返しは、十五年前と同じ屋根の上の仕事ではなかった' },
      { text: 'サエ家の屋根の残りを葺くときは、伊助家が手を貸す約束になった', when: act1Part },
      { text: '手伝いに来た村の人たちへの返しは、それぞれの家の屋根葺きの折に' },
    ],
  },
  e2: {
    id: 'e2',
    code: 'E2',
    title: '屋根は完成したけれど',
    story: [
      { text: '伊助家の屋根は、村の人たちの手で葺き上がった。' },
      { text: 'サエさんは、その様子を少し離れたところから見ていた。「返せなかったわね」と、小さく言った。' },
      { text: '結帳の十五年前の記録は、「返しはまだ」のまま残っている。どう返すかは、これから話し合うことになる。' },
    ],
    achieved: [
      { text: '伊助家の屋根を、今年の秋に葺いた' },
      { text: 'サエに無理をさせずに済んだ' },
    ],
    remains: [
      { text: '十五年前の伊助家への返しは、「まだ」のまま残った' },
      { text: 'サエ家がどう返すかは、これから話し合う' },
      { text: '手伝いに来た村の人たちへの返しは、それぞれの家の屋根葺きの折に' },
    ],
  },
  e3: {
    id: 'e3',
    code: 'E3',
    title: 'もう一度、相談しよう',
    story: [
      { text: '伊助さんは、今年の屋根葺きを見送ると決めた。屋根はもう一年もつ。' },
      { text: '誰かに無理をさせて葺くより、来年に向けて、みんなでもう一度話し合うことにした。' },
      { text: 'これは失敗ではない。結帳の記録は、次の相談のためにある。' },
    ],
    achieved: [
      { text: '誰にも無理をさせずに済んだ' },
      { text: '来年に向けて、伊助家・サエ家・村の人たちで相談を続けることになった' },
    ],
    remains: [
      { text: '伊助家の屋根は今年は葺かない（もう一年もつが、傷みは進む）' },
      { text: '十五年前の伊助家への返しは、「まだ」のまま残った' },
    ],
  },
};

/** 第1幕の結果の要約（エンディングの振り返りに使う）。 */
export function act1Summary(outcomeId: string | undefined): string {
  const o = outcomeId ? parseOutcomeId(outcomeId) : null;
  if (!o) return '—';
  const who = { solo: '伊助に頼まず予定日に', prep: '伊助に前日の準備を頼み、予定日に', wait: '刈り入れの後に延ばして', waitHelp: '刈り入れを手伝ってから延ばして' }[o.family];
  return `${who}、${o.full ? 'ミネの茅で南面をすべて' : '手持ちの茅で傷みのひどい所だけ'}葺いた`;
}
