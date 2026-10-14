import type { HouseholdId, RequestDef, StoryDefinitions, TopicDef } from '../story/types';
import { CHARACTERS } from './characters';

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
    stages: [{ id: 'needsHelp', category: 'known', text: '屋根葺きの日取りは決まっているが、手伝ってくれる人がまだ揃っていない。' }],
  },
  {
    id: 'sae.dateReason',
    title: '日取りを動かしたくない理由',
    person: 'sae',
    stages: [
      { id: 'hesitant', category: 'unconfirmed', text: 'サエは今の日取りで進めたがっている。理由はまだ聞けていない。' },
      // 設計書 D「延期することにも家族の事情がある」の段階は、内容と入手方法が未確定のため未定義（STATE_TABLE §9）
    ],
  },
  {
    id: 'sae.roof',
    title: 'サエ家の屋根',
    person: 'sae',
    stages: [{ id: 'worn', category: 'known', text: '茅が黒ずんで薄くなっている所がある。葺き替えが必要なのは確かだ。' }],
  },
  {
    id: 'isuke.field',
    title: '伊助の畑',
    person: 'isuke',
    stages: [{ id: 'harvesting', category: 'known', text: '伊助の畑は稲の刈り入れの最中。はさ掛けはまだ半分ほどしか済んでいない。' }],
  },
  {
    id: 'isuke.availability',
    title: '伊助の当日の都合',
    person: 'isuke',
    stages: [
      { id: 'declined', category: 'unconfirmed', text: '伊助は屋根葺きの日は手伝えないと言う。理由はまだ分からない。' },
      { id: 'harvest', category: 'known', text: '予定日は伊助の稲の刈り入れと重なる。天気のいいうちに刈って掛けなければならない。' },
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
        text: '結帳によると、十二年前のサエ家の屋根葺きで伊助家が人手を出した。その返しはまだ済んでいない。',
      },
      {
        id: 'isukeView',
        category: 'known',
        text: '伊助は昔の手伝いを覚えている。ただ、それと今年の都合は別の話だと考えている。',
      },
    ],
  },
  {
    id: 'sohei.roles',
    title: '屋根葺きの段取り',
    person: 'sohei',
    stages: [{ id: 'roles', category: 'known', text: '屋根葺きは人数を集めるだけでは済まない。誰がどの役目を受け持つか、段取りが要る。' }],
  },
  {
    id: 'sohei.schedule',
    title: '宗平の都合',
    person: 'sohei',
    stages: [
      {
        id: 'hasConflict',
        category: 'known',
        text: '宗平は予定日なら来られる。ただ、別の用事で動けない日もある（どの日かはまだ聞いていない）。',
      },
    ],
  },
  {
    id: 'mine.kaya',
    title: 'ミネ家の茅',
    person: 'mine',
    stages: [
      { id: 'reluctant', category: 'unconfirmed', text: 'ミネは茅を簡単には貸せないと言う。' },
      {
        id: 'returnTerms',
        category: 'known',
        text: 'ミネ家も来年は自分の家で茅を使う。貸すなら、いつ・どう返してもらうかをはっきりさせたい。',
      },
      {
        id: 'whyRecord',
        category: 'known',
        text: '以前、返し方を決めないまま茅を貸し、年が経って互いの覚えが食い違ったことがある。だからミネは記録を大事にしている。',
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
};

/** 結帳・約束の当事者になる家。 */
export const HOUSEHOLDS: Readonly<Record<HouseholdId, { readonly name: string; readonly person?: string }>> = {
  sae: { name: 'サエ家', person: 'sae' },
  isuke: { name: '伊助家', person: 'isuke' },
  mine: { name: 'ミネ家', person: 'mine' },
  sohei: { name: '宗平', person: 'sohei' },
};

export const STORY_DEFS: StoryDefinitions = {
  topics: TOPICS,
  requests: REQUESTS,
  npcs: Object.keys(CHARACTERS),
  households: Object.keys(HOUSEHOLDS),
};
