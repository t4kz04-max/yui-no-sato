import type { HouseholdId, RequestDef, StoryDefinitions, TopicDef } from '../story/types';
import { CHARACTERS } from './characters';
import { PLAN_ROOF } from './plan';
import { PLAN_ISUKE_ROOF } from './plan3';

/**
 * 情報（トピック）・依頼・家の定義。docs/STATE_TABLE.md の第2〜3節と対応する。
 * 文言は仮（本編の文言は Phase 3〜4 で確定）。人物・出来事はすべて創作。
 *
 * 段階は配列の順に進む（後ほど詳しい）。手帳の区分：known＝分かったこと、unconfirmed＝未確認。
 */
const topicList: readonly TopicDef[] = [
  {
    id: 'sae.schedule',
    title: '屋根葺きの日取り',
    person: 'sae',
    stages: [{ id: 'needsHelp', category: 'known', summary: '日取りは決まったが、人手が足りない', text: '屋根葺きの日取りは決まっているが、手伝ってくれる人がまだ揃っていない。' }],
  },
  {
    id: 'sae.dateReason',
    title: '日取りを動かしたくない理由',
    person: 'sae',
    stages: [
      { id: 'hesitant', category: 'unconfirmed', summary: '日取りを動かしたくない様子（理由は未確認）', text: 'サエは今の日取りで進めたがっている。理由はまだ聞けていない。' },
      // 以下 2 段階は Phase 3 の暫定設定（ユーザー指定）。設計書 D の「家族の事情」の中身は確定しない
      {
        id: 'roofWorry',
        category: 'known',
        summary: '屋根の傷みが進むのが心配',
        text: '屋根の傷みが進むのが心配で、日取りを延ばしたくない。',
      },
      {
        id: 'burden',
        category: 'known',
        summary: '傷みは心配。でも他の家に負担をかけるのも気がかり',
        text: '屋根の傷みが進むのは心配。けれど、急ぐことで他の家に負担をかけることも気にしている。十二年前の伊助家への返しがまだなことも気がかりだ。',
      },
    ],
  },
  {
    id: 'sae.roof',
    title: 'サエ家の屋根',
    person: 'sae',
    stages: [
      { id: 'worn', category: 'known', summary: '屋根は傷んでいて、葺き替えが要る', text: '茅が黒ずんで薄くなっている所がある。葺き替えが必要なのは確かだ。' },
      { id: 'worse', category: 'known', summary: '待つあいだに傷みが広がった', text: '葺き替えを待つあいだに、屋根の傷みが広がった。' },
      {
        id: 'partial',
        category: 'known',
        summary: '傷みのひどい所だけ葺き替えた',
        text: '手持ちの茅で、傷みのひどい所だけを葺き替えた。残りは来年以降に持ち越し。',
      },
      { id: 'renewed', category: 'known', summary: '南面は葺き替えられた', text: 'サエ家の屋根の南面は、すべて葺き替えられた。' },
    ],
  },
  {
    id: 'isuke.field',
    title: '伊助の畑',
    person: 'isuke',
    stages: [
      { id: 'harvesting', category: 'known', summary: '伊助の畑は刈り入れの最中', text: '伊助の畑は稲の刈り入れの最中。はさ掛けはまだ半分ほどしか済んでいない。' },
      {
        id: 'progress',
        category: 'known',
        summary: '刈り入れはあと十日ほど。人手があれば早まる',
        text: '刈り入れはあと十日ほどかかりそうだ。人手があれば、もっと早く済むかもしれない。',
      },
    ],
  },
  {
    id: 'isuke.availability',
    title: '伊助の当日の都合',
    person: 'isuke',
    stages: [
      { id: 'declined', category: 'unconfirmed', summary: '当日は手伝えないと言う（理由は未確認）', text: '伊助は屋根葺きの日は手伝えないと言う。理由はまだ分からない。' },
      { id: 'harvest', category: 'known', summary: '予定日は刈り入れと重なる', text: '予定日は伊助の稲の刈り入れと重なる。天気のいいうちに刈って掛けなければならない。' },
      {
        id: 'dayBefore',
        category: 'known',
        summary: '前日の半日なら抜けられるかもしれない',
        text: '前の日の半日なら、畑を離れられるかもしれない。ただ、その分刈り入れは遅れる。',
      },
    ],
  },
  {
    id: 'isuke.pastHelp',
    title: '十二年前の手伝い',
    person: 'isuke',
    stages: [
      {
        id: 'onRecord',
        category: 'known',
        summary: '十二年前に伊助家が手伝い、返しはまだ',
        text: '十二年前のサエ家の屋根葺きで、伊助家が人手を出した。その返しはまだ済んでいない。',
      },
      {
        id: 'isukeView',
        category: 'known',
        summary: '昔の手伝いと今年の都合は別、と伊助',
        text: '伊助は昔の手伝いを覚えている。ただ、それと今年の都合は別の話だと考えている。',
      },
    ],
  },
  {
    id: 'sohei.roles',
    title: '屋根葺きの段取り',
    person: 'sohei',
    stages: [{ id: 'roles', category: 'known', summary: '役目の割り振りと段取りが要る', text: '屋根葺きは人数を集めるだけでは済まない。誰がどの役目を受け持つか、段取りが要る。' }],
  },
  {
    id: 'sohei.schedule',
    title: '宗平の都合',
    person: 'sohei',
    stages: [
      {
        id: 'hasConflict',
        category: 'known',
        summary: '予定日なら来られるが、動けない日もある',
        text: '宗平は予定日なら来られる。ただ、別の用事で動けない日もある（どの日かはまだ聞いていない）。',
      },
      // 🔶 暫定設定：宗平の別件＝村の茅場の茅刈りの段取り（docs/PHASE4_DESIGN.md §2）
      {
        id: 'kayaCutting',
        category: 'known',
        summary: '刈り入れの後の頃は、茅場の茅刈りを仕切る',
        text: '刈り入れが済む頃、宗平は村の茅場の茅刈りを仕切る役目がある。茅のことに詳しいミネなら、代われるかもしれない。',
      },
    ],
  },
  {
    id: 'mine.kaya',
    title: 'ミネ家の茅',
    person: 'mine',
    stages: [
      { id: 'reluctant', category: 'unconfirmed', summary: '茅は簡単には貸せないと言う', text: 'ミネは茅を簡単には貸せないと言う。' },
      {
        id: 'returnTerms',
        category: 'known',
        summary: '貸すなら、返し方をはっきりさせたい',
        text: 'ミネ家も来年は自分の家で茅を使う。貸すなら、いつ・どう返してもらうかをはっきりさせたい。',
      },
      {
        id: 'whyRecord',
        category: 'known',
        summary: '返し方の行き違いが、以前あった',
        text: '以前、返し方を決めないまま茅を貸し、年が経って互いの覚えが食い違ったことがある。だからミネは記録を大事にしている。',
      },
    ],
  },
  {
    id: 'sae.kaya',
    title: 'サエ家の茅',
    person: 'sae',
    stages: [
      {
        id: 'short',
        category: 'known',
        summary: '手持ちの茅では、傷みのひどい所しか葺けない',
        text: 'サエ家の手持ちの茅は、傷みのひどい所を差し替える分しかない。南面をすっかり葺き直すなら、ミネ家から借りる必要がある。',
      },
    ],
  },
  {
    // 🔶 暫定設定：ミネが茅刈りを仕切れば、新しい茅の当てで今の茅を貸せる（docs/PHASE4_DESIGN.md §3）
    id: 'mine.cutting',
    title: 'ミネと茅刈り',
    person: 'mine',
    stages: [
      {
        id: 'canLead',
        category: 'known',
        summary: '茅刈りを仕切るなら、茅を貸す余裕も出る',
        text: 'ミネは宗平の代わりに茅刈りの段取りをできる。茅刈りを仕切れば新しい茅の当てがつくので、今ある茅を貸す余裕も出る。ただし、手は回らなくなる。',
      },
    ],
  },
  {
    // 🔶 暫定設定：第3幕（三年後）、サエは夏に足を痛めている（docs/PHASE4_DESIGN.md §8）
    id: 'sae.later',
    title: '三年後のサエ',
    person: 'sae',
    stages: [
      {
        id: 'injured',
        category: 'known',
        summary: '足を痛め、屋根の上には上がれない',
        text: 'サエは夏に足を痛めた。屋根の上の仕事はできないが、下で茅を受け渡したり、片付けたりすることならできる。',
      },
    ],
  },
  {
    id: 'isuke.roof3',
    title: '伊助家の屋根',
    person: 'isuke',
    stages: [
      {
        id: 'needsRoof',
        category: 'known',
        summary: '伊助家も屋根を葺き替える時が来た',
        text: '伊助家の屋根も傷み、今年の秋に葺き替えたい。十五年前にサエ家を手伝った返しは、この時でいいと伊助は言っていた。',
      },
    ],
  },
  {
    id: 'ledger.basics',
    title: '結帳',
    stages: [
      {
        id: 'read',
        category: 'known',
        summary: '結帳には、手伝いと返しの記録がある',
        text: 'サエ家の結帳には、誰がどの家の屋根葺きを手伝い、何を貸したか、その返しが済んだかが書かれている。',
      },
    ],
  },
];

export const TOPICS: Readonly<Record<string, TopicDef>> = Object.fromEntries(topicList.map((t) => [t.id, t]));

export const REQUESTS: Readonly<Record<string, RequestDef>> = {
  roofDay: { id: 'roofDay', label: '屋根葺き当日の手伝い' },
  lendKaya: { id: 'lendKaya', label: '茅の貸し出し' },
  showRecords: { id: 'showRecords', label: '貸し借りの控えを見せてもらう' },
  roofPrep: { id: 'roofPrep', label: '屋根葺き前日の準備の手伝い' },
  coverSohei: { id: 'coverSohei', label: '宗平の茅刈りの段取りを代わる' },
  isukeRoofHelp: { id: 'isukeRoofHelp', label: '伊助家の屋根葺きの手伝い' },
  isukeRoofWithoutSae: { id: 'isukeRoofWithoutSae', label: 'サエ家に頼まずに葺くこと' },
};

/** 結帳・約束の当事者になる家。 */
export const HOUSEHOLDS: Readonly<Record<HouseholdId, { readonly name: string; readonly person?: string }>> = {
  sae: { name: 'サエ家', person: 'sae' },
  isuke: { name: '伊助家', person: 'isuke' },
  mine: { name: 'ミネ家', person: 'mine' },
  sohei: { name: '宗平', person: 'sohei' },
  village: { name: '村の人たち' },
};

export const STORY_DEFS: StoryDefinitions = {
  topics: TOPICS,
  requests: REQUESTS,
  npcs: Object.keys(CHARACTERS),
  households: Object.keys(HOUSEHOLDS),
  plans: { roof: PLAN_ROOF, isukeRoof: PLAN_ISUKE_ROOF },
  planForChapter: (chapter) => (chapter === 'ch1' || chapter === 'roofDay' ? 'roof' : 'isukeRoof'),
};
