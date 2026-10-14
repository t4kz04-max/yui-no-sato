import type { DialogueChoice, DialogueScript } from '../dialogue/types';
import type { Condition } from '../story/conditions';
import { SAE_HOUSE_OPEN } from './house';

/** 第1幕のあとの章でも、サエに結帳を見せてもらえるよう頼める（家に入れなくて詰まらないように。Phase 5.5）。 */
const ASK_LEDGER_LATER: DialogueChoice = { text: '結帳を見せてもらえますか？', when: not(SAE_HOUSE_OPEN), next: 'ledgerOkLater' };
import {
  all,
  consentIs,
  consultPlan,
  flag,
  inChapter,
  knows,
  learn,
  not,
  notYet,
  outcomeIs,
  planPending,
  planPhase,
  planReason,
  setConsent,
  setFlag,
} from '../story/conditions';

/**
 * 会話・調査のデータ（仮の台詞）。どの選択肢で何が変わるかは docs/STATE_TABLE.md 第5節、
 * 計画の相談と結果は docs/VERTICAL_SLICE.md と対応する。
 *
 * - 本編のシナリオ・最終的な台詞は Phase 4 以降で確定する。ここにあるのは設計書 D・G・H 節と
 *   Phase 3 の暫定設定（ユーザー指定）に沿った、縦切り試作のための台詞。
 * - 人物・村・出来事はすべて創作。史実の説明は含めない。
 * - 住民の「意向」（setConsent）は本人がはっきり表明したときだけ記録する。
 * - 計画への返事（consultPlan）は content/plan.ts の規則で決まり、台詞はその理由ごとに書く。
 */

/** 第1幕の結果（誰が加わったか）。 */
const fam = (...families: string[]): Condition => ({
  any: families.flatMap((f) => [{ outcome: [`${f}-full`] }, { outcome: [`${f}-part`] }]),
});
/** 第1幕でミネの茅を借りた（南面をすべて葺いた）。 */
const fullKaya: Condition = { any: ['solo', 'prep', 'wait', 'waitHelp'].map((f) => ({ outcome: [`${f}-full`] })) };
/** 第1幕で手持ちの茅だけで葺いた（一部だけ）。 */
const partial: Condition = { any: ['solo', 'prep', 'wait', 'waitHelp'].map((f) => ({ outcome: [`${f}-part`] })) };

/** 宗平に聞けること。 */
const SOHEI_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('sohei'), next: 'planConsult' },
  { text: '宗平さんは当日来られますか？', when: consentIs('sohei', 'roofDay', 'none'), next: 'canCome' },
  {
    text: '動けない日というのは？',
    when: all(knows('sohei.schedule', 'hasConflict'), notYet('sohei.schedule', 'kayaCutting')),
    next: 'kayaCutting',
  },
];

/** ミネに聞けること。 */
const MINE_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('mine'), next: 'planConsult' },
  { text: 'どうしたら貸してもらえますか？', when: notYet('mine.kaya', 'returnTerms'), next: 'how' },
  {
    text: '貸し借りの控えを見せてもらえますか？',
    when: all(knows('mine.kaya', 'returnTerms'), consentIs('mine', 'showRecords', 'none')),
    next: 'recordsAsk',
  },
  {
    text: '宗平さんの茅刈りの段取りを、代われませんか？',
    when: all(knows('sohei.schedule', 'kayaCutting'), notYet('mine.cutting', 'canLead')),
    next: 'cutting',
  },
];

/** 第3幕でサエに聞けること。 */
const SAE3_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('sae'), next: 'planConsult3' },
  { text: '体、どうかしたんですか？', when: notYet('sae.later', 'injured'), next: 'injury' },
  ASK_LEDGER_LATER,
];

/** 第3幕で伊助に聞けること。 */
const ISUKE3_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('isuke'), next: 'planConsult3' },
];

/** サエに聞けること（会話の中で何度でも戻ってくる一覧）。 */
const SAE_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('sae'), next: 'planConsult' },
  { text: '日取りは動かせないんですか？', when: notYet('sae.dateReason', 'hesitant'), next: 'date' },
  { text: '茅は足りていますか？', when: notYet('sae.kaya', 'short'), next: 'kaya' },
  {
    text: '屋根、だいぶ傷んでいますね',
    when: all(knows('sae.roof'), notYet('sae.dateReason', 'roofWorry')),
    next: 'roofWorry',
  },
  {
    text: '十二年前の伊助さんの手伝い、まだ返していないそうですね',
    when: all(knows('isuke.pastHelp'), notYet('sae.dateReason', 'burden')),
    next: 'burden',
  },
  {
    text: '結帳を見てもいいですか？',
    when: not(SAE_HOUSE_OPEN),
    next: 'ledgerOk',
  },
];

/** 伊助に聞けること。 */
const ISUKE_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('isuke'), next: 'planConsult' },
  {
    text: '畑のはさ掛けを見てきました',
    when: all(knows('isuke.field'), notYet('isuke.availability', 'harvest')),
    next: 'harvest',
  },
  {
    text: '刈り入れの間、少しも抜けられませんか？',
    when: all(knows('isuke.availability', 'harvest'), notYet('isuke.availability', 'dayBefore')),
    next: 'dayBefore',
  },
  {
    text: '十二年前、サエさんの家を手伝ったと聞きました',
    when: all(knows('isuke.pastHelp'), notYet('isuke.pastHelp', 'isukeView')),
    next: 'pastHelp',
  },
];

export const DIALOGUES: Readonly<Record<string, DialogueScript>> = {
  // ─────────── トキ（気さくな案内役） ───────────
  toki: {
    id: 'toki',
    entries: [
      { when: all(inChapter('end'), outcomeIs('e1')), node: 'endE1' },
      { when: all(inChapter('end'), outcomeIs('e2')), node: 'endE2' },
      { when: inChapter('end'), node: 'endE3' },
      { when: all(inChapter('ch3'), notYet('sae.later', 'injured')), node: 'ch3Hint' },
      { when: inChapter('ch3'), node: 'ch3' },
      { when: all(inChapter('roofDay'), fam('solo')), node: 'daySolo' },
      { when: all(inChapter('roofDay'), fam('prep')), node: 'dayPrep' },
      { when: inChapter('roofDay'), node: 'dayWait' },
      { when: planPhase('revise'), node: 'planRevise' },
      { when: planPhase('ready'), node: 'planReady' },
      { when: knows('isuke.availability', 'harvest'), node: 'afterHarvest' },
      { when: knows('isuke.availability'), node: 'hintIsuke' },
      { when: all(flag('talked:sae'), notYet('ledger.basics', 'read')), node: 'ledgerHint' },
      { when: flag('talked:sae'), node: 'afterSae' },
      { when: flag('talked:toki'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      daySolo: {
        speaker: 'toki',
        lines: ['すごい人だね！ ……でも、**伊助さんの姿はない**ね。畑かな。'],
      },
      dayPrep: {
        speaker: 'toki',
        lines: ['昨日、伊助さんが組んだ足場、しっかりしてるって宗平さんが言ってたよ。', '**今度はサエさんの家が、刈り入れを手伝う番**だね。'],
      },
      dayWait: {
        speaker: 'toki',
        lines: ['伊助さんも宗平さんもそろったね。ミネさんは茅場で茅刈りだって。', '待った分、屋根は傷んじゃったけど……**みんなで動いた**ね。'],
      },
      ch3Hint: {
        speaker: 'toki',
        lines: [
          '久しぶり！ 今度は**伊助さんの家の屋根葺き**なんだって。また相談役、頼まれたんでしょ？',
          '……そういえば、**サエさん、夏に足を痛めたんだって**。無理してないといいけど。',
        ],
        effects: [learn('sae.later', 'injured')],
      },
      ch3: {
        speaker: 'toki',
        lines: ['伊助さんの屋根、どう段取りするの？', '記録どおりにいかないこともあるよね。同じ約束でも、今の事情で見え方が変わるんだ。'],
      },
      endE1: {
        speaker: 'toki',
        lines: ['伊助さんの屋根、みんなで葺けたね。サエさんも下でずっと動いてたよ。'],
        next: 'endNote',
      },
      endE2: {
        speaker: 'toki',
        lines: ['伊助さんの屋根、きれいに葺き上がったね。……サエさん、ちょっと寂しそうだった。'],
        next: 'endNote',
      },
      endE3: {
        speaker: 'toki',
        lines: ['今年は見送りだって。来年に向けて、また相談だね。'],
        next: 'endNote',
      },
      endNote: {
        lines: ['（物語はここまで。村を歩いて、結帳や手帳を見返すことができる。最初から遊ぶときは、ポーズ画面から。）'],
      },
      first: {
        speaker: 'toki',
        lines: [
          'あ、来た来た！ 宗平さんから聞いたよ。屋根葺きの相談役、頼まれたんだって？',
          '相談役っていっても、誰かに命令できるわけじゃないからね。まずはみんなの話を聞いて回るところからだよ。',
        ],
        choices: [
          { text: 'まず何をすればいい？', next: 'whatToDo' },
          { text: '話の聞き方を教えて', next: 'howTo' },
        ],
      },
      howTo: {
        speaker: 'toki',
        lines: [
          '気になる人や物に近づくと「E」って出るでしょ。そこで E を押せば、話したり調べたりできるよ。',
          '聞いたことは手帳に書き留めておくといいよ。Tab で開けるでしょ？ 後から読み返すと、見え方が変わることもあるから。',
        ],
        choices: [{ text: 'まず何をすればいい？', next: 'whatToDo' }, { text: 'ありがとう' }],
      },
      whatToDo: {
        speaker: 'toki',
        lines: [
          '屋根を葺くのはサエさんの家。広場の先にある、いちばん大きな家だよ。',
          'まずはサエさんに話を聞いてみたら？ 段取りは、北の宗平さんの作業台で考えるといいよ。',
        ],
      },
      again: {
        speaker: 'toki',
        lines: ['サエさんの家は広場の先、真ん中の大きな家だよ。'],
      },
      ledgerHint: {
        speaker: 'toki',
        lines: [
          'サエさんの家の中に、結帳がしまってあるはずだよ。**サエさんに頼めば見せてくれる**と思う。',
          '昔、誰がどの家を手伝ったか書いてあるんだって。みんなの話と合わせて見ると、何か分かるかもね。',
        ],
      },
      afterSae: {
        speaker: 'toki',
        lines: ['伊助さん、宗平さん、ミネさん……みんなそれぞれ都合があるからね。回る順番は好きにしていいと思うよ。'],
      },
      hintIsuke: {
        speaker: 'toki',
        lines: [
          '伊助さんに断られた？ あの人、理由をあんまり言わないからなあ。',
          '家の向こうの畑のほうを見てきたら？ 何か分かるかもよ。',
        ],
      },
      afterHarvest: {
        speaker: 'toki',
        lines: ['刈り入れかあ……。同じ「手伝えない」でも、理由が分かると見え方が変わるね。'],
      },
      planRevise: {
        speaker: 'toki',
        lines: [
          '相談、うまくいかなかった？',
          '断られたなら、どうして断られたのかを考えてみたら？ 案が変われば、返事も変わるかもしれないよ。',
        ],
      },
      planReady: {
        speaker: 'toki',
        lines: ['みんな承知してくれたなら、作業台で決められるね。', '……決めたら、もう後戻りはできないよ。それでいいか、もう一度考えてみてもいいかもね。'],
      },
    },
  },

  // ─────────── サエ（屋根葺きを控えた家の家主） ───────────
  sae: {
    id: 'sae',
    entries: [
      { when: all(inChapter('end'), outcomeIs('e1')), node: 'endE1' },
      { when: all(inChapter('end'), outcomeIs('e2')), node: 'endE2' },
      { when: inChapter('end'), node: 'endE3' },
      { when: all(inChapter('ch3'), flag('ch3:sae')), node: 'ch3Again' },
      { when: inChapter('ch3'), node: 'ch3' },
      { when: all(inChapter('roofDay'), partial), node: 'dayPart' },
      { when: all(inChapter('roofDay'), fam('solo')), node: 'daySolo' },
      { when: all(inChapter('roofDay'), fam('prep')), node: 'dayPrep' },
      { when: inChapter('roofDay'), node: 'dayWait' },
      { when: flag('talked:sae'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      kaya: {
        speaker: 'sae',
        lines: ['うちの手持ちは、**傷みのひどい所を差し替えるくらい**しかないの。', '南面をすっかり葺き直すなら、ミネさんに借りないと。'],
        effects: [learn('sae.kaya', 'short')],
        next: 'more',
      },
      rePartial: {
        speaker: 'sae',
        lines: ['手持ちの茅だけで……**全部は葺けない**のね。', 'でも、借りを増やさずに済むなら、それもいいのかもしれない。'],
        effects: [learn('sae.kaya', 'short')],
      },

      // 屋根葺き当日（サエと話すと一日を終えられる）
      daySolo: {
        speaker: 'sae',
        lines: ['人手は少ないけれど、宗平さんの段取りでなんとか進んでるわ。', '**今日のうちには終わらない**わね。明日もよ。'],
        next: 'dayEnd',
      },
      dayPrep: {
        speaker: 'sae',
        lines: ['伊助さんが昨日、足場を組んでくれたの。**今日は早く終わりそう**。', '明日からは、うちが伊助さんの刈り入れを手伝う番ね。'],
        next: 'dayEnd',
      },
      dayWait: {
        speaker: 'sae',
        lines: ['待った甲斐があったわね。みんな揃ってる。', '……**傷みは広がってしまった**けれど。'],
        next: 'dayEnd',
      },
      dayPart: {
        speaker: 'sae',
        lines: ['手持ちの茅で葺けるのは、**傷みのひどい所だけ**。', '残りは来年ね。……それでも、今日できることはやるわ。'],
        next: 'dayEnd',
      },
      dayEnd: {
        lines: ['（日が傾いてきた。）'],
        choices: [
          // 葺き替えの記録は、作業の日を終えたときに付ける（決めた時点ではまだ葺いていない。Phase 6）
          { text: '一日を終える', when: not(partial), effects: [learn('sae.roof', 'renewed'), setFlag('roofDay:ended')] },
          { text: '一日を終える', when: partial, effects: [learn('sae.roof', 'partial'), setFlag('roofDay:ended')] },
          ASK_LEDGER_LATER,
          { text: 'もう少し見て回る' },
        ],
      },

      // 第3幕
      ch3: {
        speaker: 'sae',
        lines: [
          'あら、久しぶりね。伊助さんの屋根の話でしょう？',
          '十五年前に手伝ってもらった分、**今度こそ返さないと**。……ただ、今年はちょっと、体がね。',
        ],
        effects: [setFlag('ch3:sae')],
        choices: [...SAE3_TOPICS, { text: '行ってきます' }],
      },
      ch3Again: {
        speaker: 'sae',
        lines: ['伊助さんの屋根、うまくいくといいわね。'],
        choices: [...SAE3_TOPICS, { text: '行ってきます' }],
      },
      injury: {
        speaker: 'sae',
        lines: ['……夏に足を痛めてしまったの。**屋根の上は、もう無理ね**。', '下で茅を渡したり、片付けたりなら、できるんだけど。'],
        effects: [learn('sae.later', 'injured')],
        choices: [...SAE3_TOPICS, { text: '行ってきます' }],
      },
      planConsult3: {
        lines: ['（伊助家の屋根葺きの案を、サエさんに話した。）'],
        choices: [{ text: 'この案でお願いできますか', effects: [consultPlan('sae')], next: 'planReact3' }, { text: 'やっぱり考え直します' }],
      },
      planReact3: {
        lines: ['サエさんは少し黙っていた。'],
        branches: [
          { when: planReason('sae', 'injured'), next: 're3Injured' },
          { when: planReason('sae', 'groundOk'), next: 're3Ground' },
        ],
      },
      re3Injured: {
        speaker: 'sae',
        lines: [
          '……記録どおりにしたい気持ちはあるの。十五年前、伊助さんは屋根の上で働いてくれたんだから。',
          'でも、**この足では屋根に上がれない**。……ごめんなさい。',
        ],
        effects: [learn('sae.later', 'injured')],
      },
      re3Ground: {
        speaker: 'sae',
        lines: ['**下の仕事なら、この足でもできる**わ。', '十五年前と同じではないけれど……伊助さんがそれでいいと言ってくれるなら。'],
      },

      endE1: {
        speaker: 'sae',
        lines: ['下の仕事でも、返せてよかった。', '伊助さんが「**これで十分だ**」って言ってくれたの。'],
        choices: [ASK_LEDGER_LATER, { text: '失礼します' }],
      },
      endE2: {
        speaker: 'sae',
        lines: ['返せなかったわね……。この足じゃ、どうにもならなかった。', 'でも、**まだ話し合える**わ。'],
        choices: [ASK_LEDGER_LATER, { text: '失礼します' }],
      },
      endE3: {
        speaker: 'sae',
        lines: ['伊助さんが、今年は見送るって。', '……私の足のことも、考えてくれたのかしらね。'],
        choices: [ASK_LEDGER_LATER, { text: '失礼します' }],
      },
      first: {
        speaker: 'sae',
        lines: [
          'あら、あなたが相談役を引き受けてくれたのね。',
          '屋根の葺き替え、日取りはもう決めてあるの。でも、**手伝ってもらえる人がなかなか揃わなくて**……。',
        ],
        effects: [learn('sae.schedule', 'needsHelp')],
        choices: [{ text: '誰に声をかければいいですか？', next: 'who' }, ...SAE_TOPICS, { text: '行ってきます' }],
      },
      more: {
        speaker: 'sae',
        lines: ['ほかに聞きたいことはある？'],
        choices: [...SAE_TOPICS, { text: '行ってきます' }],
      },
      date: {
        speaker: 'sae',
        lines: ['……できれば、今の日取りで進めたいの。'],
        next: 'dateThought',
      },
      dateThought: {
        lines: ['（何か事情がありそうだ。今は深く聞かないでおこう。）'],
        effects: [learn('sae.dateReason', 'hesitant')],
        next: 'more',
      },
      roofWorry: {
        speaker: 'sae',
        lines: ['ええ……。今年のうちに葺き替えないと、**傷みが中まで進んでしまう**の。', 'だから、日取りはできるだけ延ばしたくないのよ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
        next: 'more',
      },
      burden: {
        speaker: 'sae',
        lines: [
          '……そうなの。**うちはまだ返せていない**。',
          '屋根は急ぎたい。でも、そのせいでまた誰かに無理をさせるのは、気が重いのよ。',
        ],
        effects: [learn('sae.dateReason', 'burden')],
        next: 'more',
      },
      who: {
        speaker: 'sae',
        lines: [
          '隣の伊助さん、作業場の宗平さん、それに茅のことならミネさんね。',
          'みんな忙しい時期だから、無理は言えないんだけど。段取りは宗平さんの作業台で考えるといいわ。',
        ],
        next: 'more',
      },
      ledgerOk: {
        speaker: 'sae',
        lines: [
          'ええ、どうぞ上がって。**囲炉裏の奥の棚の文箱**に入ってるわ。',
          'うちの屋根葺きで誰に何をしてもらったか、書いてあるはずよ。入口の戸は開けてあるから。',
        ],
        effects: [setFlag('asked:saeLedger')],
        next: 'more',
      },
      ledgerOkLater: {
        speaker: 'sae',
        lines: ['ええ、どうぞ上がって。結帳は**囲炉裏の奥の棚の文箱**よ。'],
        effects: [setFlag('asked:saeLedger')],
      },
      again: {
        speaker: 'sae',
        lines: ['伊助さん、宗平さん、ミネさん。話を聞いてきてくれる？'],
        choices: [...SAE_TOPICS, { text: '行ってきます' }],
      },

      // 計画の相談（サエは家主として、すべての案に返事をする）
      planConsult: {
        lines: ['（作業台でまとめた案を、サエさんに話した。）'],
        choices: [
          { text: 'この案でいいですか？', effects: [consultPlan('sae')], next: 'planReact' },
          { text: 'やっぱり考え直します' },
        ],
      },
      planReact: {
        lines: ['サエさんは、しばらく案を見つめていた。'],
        branches: [
          { when: planReason('sae', 'partialRoof'), next: 'rePartial' },
          { when: planReason('sae', 'noIsuke'), next: 'reNoIsuke' },
          { when: planReason('sae', 'reliesOnIsuke'), next: 'reRelies' },
          { when: planReason('sae', 'withReturn'), next: 'reWithReturn' },
          { when: planReason('sae', 'pointlessDelay'), next: 'reDelayNo' },
          { when: planReason('sae', 'delayWorry'), next: 'reDelayWorry' },
          { when: planReason('sae', 'delayWithReturn'), next: 'reDelayReturn' },
        ],
      },
      reNoIsuke: {
        speaker: 'sae',
        lines: ['伊助さんに無理を言わずに済むなら、それがいいのかもしれない。', '**人手が少ないから、二日はかかる**わね。うちの者と村の人たちで、なんとかするわ。'],
      },
      reRelies: {
        speaker: 'sae',
        lines: [
          '……また伊助さんに頼ることになるのね。',
          '**うちは十二年前の分も、まだ返せていないのに**。……でも、あなたがそう考えたのなら、それでいいわ。',
        ],
        effects: [learn('isuke.pastHelp', 'onRecord'), learn('sae.dateReason', 'burden')],
      },
      reWithReturn: {
        speaker: 'sae',
        lines: [
          '伊助さんの刈り入れに、うちからも人を出すのね。',
          '**屋根葺きのすぐ後だから、うちの者にはこたえる**けれど……頼むだけというのは気が引けるもの。それでいきましょう。',
        ],
        effects: [learn('sae.dateReason', 'burden')],
      },
      reDelayNo: {
        speaker: 'sae',
        lines: ['伊助さんが当日来られないのに、延ばすの？', '待つあいだにも屋根は傷むのよ。それなら、予定どおりにやりたいわ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
      },
      reDelayWorry: {
        speaker: 'sae',
        lines: ['刈り入れの後まで延ばすのね……。', '**待てば傷みは進む**。それでも、伊助さんが来てくれるなら……分かったわ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
      },
      reDelayReturn: {
        speaker: 'sae',
        lines: ['延ばして、待つあいだに伊助さんの刈り入れを手伝うのね。', '**うちの屋根は後回し**ね……。でも、そのほうが筋が通る気がする。やってみましょう。'],
        effects: [learn('sae.dateReason', 'burden')],
      },

    },
  },

  // ─────────── 伊助（協力を断る隣家の住民） ───────────
  isuke: {
    id: 'isuke',
    entries: [
      { when: all(inChapter('end'), outcomeIs('e1')), node: 'endE1' },
      { when: all(inChapter('end'), outcomeIs('e2')), node: 'endE2' },
      { when: inChapter('end'), node: 'endE3' },
      { when: all(inChapter('ch3'), flag('ch3:isuke')), node: 'ch3Again' },
      { when: inChapter('ch3'), node: 'ch3' },
      { when: all(inChapter('roofDay'), fam('wait', 'waitHelp')), node: 'dayOnRoof' },
      { when: all(inChapter('roofDay'), fam('prep')), node: 'dayPrep' },
      { when: inChapter('roofDay'), node: 'daySolo' },
      { when: knows('isuke.availability', 'harvest'), node: 'afterHarvest' },
      { when: flag('talked:isuke'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      // 屋根葺き当日
      dayOnRoof: {
        speaker: 'isuke',
        lines: ['刈り入れが済んでな。**今日は屋根の上だ**。'],
      },
      dayPrep: {
        speaker: 'isuke',
        lines: ['昨日は足場を組んできた。今日は刈り入れだ。', '……**天気がもってくれてよかった**。'],
      },
      daySolo: {
        speaker: 'isuke',
        lines: ['屋根葺きか。うちは刈り入れで手一杯だ。', '……悪く思わんでくれ。'],
      },

      // 第3幕
      ch3: {
        speaker: 'isuke',
        lines: [
          '三年ぶりだな、相談役。**今度はうちの屋根だ**。',
          '十五年前、サエさんの家を手伝ったろう。返してもらうのは、うちの屋根の時でいいと言った。……その時が来た。',
        ],
        effects: [learn('isuke.roof3', 'needsRoof'), setFlag('ch3:isuke')],
        branches: [
          { when: fam('prep'), next: 'ch3Prep' },
          { when: fam('wait', 'waitHelp'), next: 'ch3Wait' },
        ],
        next: 'ch3Solo',
      },
      ch3Prep: {
        speaker: 'isuke',
        lines: ['三年前は、刈り入れを手伝ってもらった。あれは助かった。', '段取りは、作業台で考えてくれ。'],
        choices: [...ISUKE3_TOPICS, { text: '考えてみます' }],
      },
      ch3Wait: {
        speaker: 'isuke',
        lines: ['三年前は、待ってもらって屋根に上がらせてもらったな。', '段取りは、作業台で考えてくれ。'],
        choices: [...ISUKE3_TOPICS, { text: '考えてみます' }],
      },
      ch3Solo: {
        speaker: 'isuke',
        lines: ['三年前は手伝えんかった。だからといって、今度のことは別の話だ。', '段取りは、作業台で考えてくれ。'],
        choices: [...ISUKE3_TOPICS, { text: '考えてみます' }],
      },
      ch3Again: {
        speaker: 'isuke',
        lines: ['段取りはどうだ。'],
        choices: [...ISUKE3_TOPICS, { text: '失礼します' }],
      },
      planConsult3: {
        lines: ['（伊助家の屋根葺きの案を、伊助さんに話した。）'],
        choices: [{ text: 'この案でどうでしょう', effects: [consultPlan('isuke')], next: 'planReact3' }, { text: 'やっぱり考え直します' }],
      },
      planReact3: {
        lines: ['伊助さんは屋根を見上げた。'],
        branches: [
          { when: planReason('isuke', 'postpone'), next: 're3Postpone' },
          { when: planReason('isuke', 'asRecorded'), next: 're3Recorded' },
          { when: planReason('isuke', 'groundFine'), next: 're3Ground' },
          { when: planReason('isuke', 'withoutSae'), next: 're3Without' },
        ],
      },
      re3Postpone: {
        speaker: 'isuke',
        lines: ['見送るか。……屋根はもう一年もつ。', '**急いで誰かに無理をさせることはない**。'],
      },
      re3Recorded: {
        speaker: 'isuke',
        lines: ['記録どおりに来てもらえるなら、ありがたい。', '……だが、**サエさんの都合も聞いたのか**？'],
      },
      re3Ground: {
        speaker: 'isuke',
        lines: ['屋根の上でなくても、手を貸してもらえるならありがたい。', '**十五年前の分は、それで十分だ**。'],
      },
      re3Without: {
        speaker: 'isuke',
        lines: ['サエさんに無理はさせられん。村の手を借りて葺くさ。', '……**返しのことは、また別に考えよう**。'],
      },

      endE1: {
        speaker: 'isuke',
        lines: ['サエさんが下で茅を渡してくれた。', '**十五年前の分は、これで十分だ**。'],
      },
      endE2: {
        speaker: 'isuke',
        lines: ['屋根は葺けた。サエさんには、無理をさせずに済んだ。', '返しのことは、またゆっくり話そう。'],
      },
      endE3: {
        speaker: 'isuke',
        lines: ['今年は見送った。屋根はもう一年もつ。', '来年、改めて相談に乗ってくれ。'],
      },
      first: {
        speaker: 'isuke',
        lines: ['屋根葺きの手伝い？ ……悪いが、**その日は無理だ**。'],
        effects: [
          learn('isuke.availability', 'declined'),
          setConsent('isuke', 'roofDay', 'declined', '当日は手伝えない'),
        ],
        choices: [{ text: 'どうしてですか？', next: 'why' }, ...ISUKE_TOPICS, { text: '分かりました' }],
      },
      why: {
        speaker: 'isuke',
        lines: ['こっちにも都合がある。それだけだ。'],
      },
      again: {
        speaker: 'isuke',
        lines: ['まだ何か用か。その日は無理だと言ったろう。'],
        choices: [...ISUKE_TOPICS, { text: '失礼しました' }],
      },
      harvest: {
        speaker: 'isuke',
        lines: [
          '……見たのか。**ちょうど稲の刈り入れが重なっていてな**。',
          '天気のいいうちに刈って掛けんと、一年の米が駄目になる。屋根の日に、ここは空けられん。',
        ],
        next: 'harvestNote',
      },
      harvestNote: {
        lines: ['（伊助さんが断ったのは、屋根葺きの日が稲の刈り入れと重なるからだった。）'],
        effects: [learn('isuke.availability', 'harvest')],
      },
      dayBefore: {
        speaker: 'isuke',
        lines: ['……**前の日の半日くらいなら、抜けられんこともない**。', 'だが、その分刈り入れは遅れる。遅れをどうするか、だな。'],
        effects: [learn('isuke.availability', 'dayBefore')],
      },
      pastHelp: {
        speaker: 'isuke',
        lines: [
          '十二年前……ああ、サエさんの家の時か。確かに手伝いに出た。',
          'だがな、**昔手伝ったからといって、今年の刈り入れが待ってくれるわけじゃない**。返してもらうのは、いずれうちの屋根の時でいい。',
        ],
        effects: [learn('isuke.pastHelp', 'isukeView')],
      },
      afterHarvest: {
        speaker: 'isuke',
        lines: ['刈り入れが済むまでは、こっちも手一杯だ。……悪く思わんでくれ。'],
        choices: [...ISUKE_TOPICS, { text: 'お邪魔しました' }],
      },

      // 計画の相談
      planConsult: {
        lines: ['（作業台でまとめた案を、伊助さんに話した。）'],
        choices: [
          { text: 'この案で手伝ってもらえませんか', effects: [consultPlan('isuke')], next: 'planReact' },
          { text: '十二年前の手伝いを持ち出して頼む', when: knows('isuke.pastHelp'), next: 'pastAppeal' },
          { text: 'やっぱり考え直します' },
        ],
      },
      pastAppeal: {
        speaker: 'isuke',
        lines: [
          '十二年前の話か。……覚えとるよ。',
          'だがな、昔のことで今年の刈り入れが待ってくれるわけじゃない。それとこれとは別の話だ。案そのものを聞かせてくれ。',
        ],
        effects: [learn('isuke.pastHelp', 'isukeView')],
        next: 'planConsult',
      },
      planReact: {
        lines: ['伊助さんは腕を組んで考えている。'],
        branches: [
          { when: all(planReason('isuke', 'harvestConflict'), knows('isuke.availability', 'harvest')), next: 'reConflictKnown' },
          { when: planReason('isuke', 'harvestConflict'), next: 'reConflict' },
          { when: planReason('isuke', 'needsCover'), next: 'reNeedsCover' },
          { when: planReason('isuke', 'prepWithHelp'), next: 'rePrepOk' },
          { when: planReason('isuke', 'afterHarvest'), next: 'reAfterOk' },
          { when: planReason('isuke', 'afterHarvestHelp'), next: 'reAfterHelpOk' },
          { when: planReason('isuke', 'onlyDayBefore'), next: 'reOnlyBefore' },
        ],
      },
      reConflictKnown: {
        speaker: 'isuke',
        lines: ['刈り入れの日に屋根には上がれん。それは前にも話したはずだ。', '**日取りか、頼み方か**……どちらかを変えてくれんと、どうにもならん。'],
      },
      reConflict: {
        speaker: 'isuke',
        lines: ['その日は無理だと言ったろう。こっちにも都合がある。'],
      },
      reNeedsCover: {
        speaker: 'isuke',
        lines: [
          '前の日の半日か……。抜けられんことはない。',
          'だが、その分刈り入れが遅れる。**遅れた分をどうするのか**。そこが決まらんうちは、うんとは言えん。',
        ],
      },
      rePrepOk: {
        speaker: 'isuke',
        lines: ['前の日の半日、茅運びと足場なら出よう。', '刈り入れを手伝ってもらえるなら、遅れも取り戻せる。……約束だぞ。'],
      },
      reAfterOk: {
        speaker: 'isuke',
        lines: ['刈り入れの後か。それなら当日から出られる。', 'ただ、サエさんの屋根はそれまで待つことになるな。'],
      },
      reAfterHelpOk: {
        speaker: 'isuke',
        lines: ['刈り入れを手伝ってもらえるなら、早く片がつく。', '片づいたら、屋根の日は朝から出よう。'],
      },
      reOnlyBefore: {
        speaker: 'isuke',
        lines: ['刈り入れの後で、前の日だけか。それなら出られるが……当日の人手は足りるのか？'],
      },

    },
  },

  // ─────────── 宗平（経験ある世話役） ───────────
  sohei: {
    id: 'sohei',
    entries: [
      { when: inChapter('end'), node: 'end' },
      { when: all(inChapter('ch3'), fam('wait', 'waitHelp')), node: 'ch3Owe' },
      { when: inChapter('ch3'), node: 'ch3' },
      { when: all(inChapter('roofDay'), partial), node: 'dayPart' },
      { when: all(inChapter('roofDay'), fam('solo')), node: 'daySolo' },
      { when: all(inChapter('roofDay'), fam('prep')), node: 'dayPrep' },
      { when: inChapter('roofDay'), node: 'dayWait' },
      { when: all(flag('talked:sohei'), planPhase('revise')), node: 'planRevise' },
      { when: flag('talked:sohei'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'sohei',
        lines: [
          'お前さんが相談役か。宗平だ。',
          '屋根葺きは、人を集めれば済む話じゃない。**誰がどの役目を受け持つか、段取りが要る**。',
          'まずは皆の都合を聞いてこい。計画を立てるのはそれからだ。',
        ],
        effects: [learn('sohei.roles', 'roles')],
        choices: [...SOHEI_TOPICS, { text: '分かりました' }],
      },
      canCome: {
        speaker: 'sohei',
        lines: ['予定の日なら行ける。', 'ただ、**わしにも動かせん用事のある日がある**。日取りを動かす話になったら、先に言ってくれ。'],
        effects: [learn('sohei.schedule', 'hasConflict'), setConsent('sohei', 'roofDay', 'conditional', '予定日なら来られる')],
        next: 'more',
      },
      kayaCutting: {
        speaker: 'sohei',
        lines: [
          '刈り入れが済む頃は、村の茅場で茅刈りがある。**わしはその段取りを任されとる**。',
          '茅のことなら、**ミネのほうがよっぽど詳しい**がな。',
        ],
        effects: [learn('sohei.schedule', 'kayaCutting')],
        next: 'more',
      },
      more: {
        speaker: 'sohei',
        lines: ['ほかに聞きたいことは？'],
        choices: [...SOHEI_TOPICS, { text: '失礼します' }],
      },
      planRevise: {
        speaker: 'sohei',
        lines: [
          '返事が割れたか。誰が、何を理由に首を振ったのか、よく考えることだ。',
          '紙は何度でも書き直せる。だが、人に無理を通すための書き直しはするなよ。',
        ],
        choices: [...SOHEI_TOPICS, { text: '失礼します' }],
      },
      again: {
        speaker: 'sohei',
        lines: ['皆の都合は聞けたか。急がんでいい、聞き漏らしのないようにな。'],
        choices: [...SOHEI_TOPICS, { text: '失礼します' }],
      },

      // 計画の相談（宗平は段取り役として、すべての案に返事をする）
      planConsult: {
        lines: ['（作業台でまとめた案を、宗平さんに話した。）'],
        choices: [{ text: 'この段取りで見てもらえますか', effects: [consultPlan('sohei')], next: 'planReact' }, { text: 'やっぱり考え直します' }],
      },
      planReact: {
        lines: ['宗平さんは紙をじっと見ている。'],
        branches: [
          { when: planReason('sohei', 'kayaCuttingDay'), next: 'reCutting' },
          { when: planReason('sohei', 'coveredByMine'), next: 'reCovered' },
          { when: planReason('sohei', 'partialOnly'), next: 'rePartial' },
          { when: planReason('sohei', 'fewHands'), next: 'reFewHands' },
          { when: planReason('sohei', 'prepGood'), next: 'rePrepGood' },
          { when: planReason('sohei', 'soheiReady'), next: 'reReady' },
        ],
      },
      reCutting: {
        speaker: 'sohei',
        lines: [
          'その頃は**茅場の茅刈りがある**。わしが仕切らんと始まらん。',
          '延ばすなら、茅刈りを誰かに任せる算段がいるな。……茅のことなら、ミネが詳しいが。',
        ],
        effects: [learn('sohei.schedule', 'kayaCutting')],
      },
      reCovered: {
        speaker: 'sohei',
        lines: ['ミネが茅刈りを見てくれるなら、わしはこっちに来られる。', '**ミネには借りができる**な。'],
      },
      rePartial: {
        speaker: 'sohei',
        lines: ['茅が足りんなら、**傷みのひどい所だけ**にしよう。', '残りは来年だ。それでもよければ段取りはつける。'],
      },
      reFewHands: {
        speaker: 'sohei',
        lines: ['人手が少ない。**二日がかり**になるぞ。', 'それでよければ、段取りはわしが見る。'],
      },
      rePrepGood: {
        speaker: 'sohei',
        lines: ['前の日に足場と茅運びが済めば、**当日は段取りよく進む**。', 'いい段取りだ。'],
      },
      reReady: {
        speaker: 'sohei',
        lines: ['予定の日なら行ける。段取りは見る。'],
      },

      // 屋根葺き当日
      daySolo: {
        speaker: 'sohei',
        lines: ['人手が少ない。**今日のうちには終わらん**、明日もだ。', 'それでも、段取りどおりには進んどる。'],
      },
      dayPrep: {
        speaker: 'sohei',
        lines: ['昨日のうちに足場ができとる。**今日は早いぞ**。', '伊助の組んだ足場は、しっかりしとる。'],
      },
      dayWait: {
        speaker: 'sohei',
        lines: ['ミネが茅刈りを仕切ってくれたおかげで、こっちに来られた。', '**借りができた**な。いつか返さにゃならん。'],
      },
      dayPart: {
        speaker: 'sohei',
        lines: ['茅が足りん分は、**傷みのひどい所だけ**だ。', '残りは来年。今日はできるところを、きちんとやる。'],
      },

      // 第3幕
      ch3: {
        speaker: 'sohei',
        lines: [
          '三年経ったな。伊助の屋根の段取りは、わしが見る。',
          'だが、誰がどこに入るかは本人たちに聞け。**記録に書いてあるからといって、人を動かせるわけじゃない**。',
        ],
      },
      ch3Owe: {
        speaker: 'sohei',
        lines: [
          '三年前は、ミネに茅刈りを代わってもらった。**今年は、わしがミネの茅刈りを手伝う番だ**。',
          '伊助の屋根の段取りも見る。だが、誰がどこに入るかは本人たちに聞け。',
        ],
      },

      // エンディングの後
      end: {
        speaker: 'sohei',
        lines: ['伊助の屋根のことも、見届けたな。', '決めたことがどう転んだか、最後まで見るのも相談役の仕事だ。……ご苦労だった。'],
      },
    },
  },

  // ─────────── ミネ（茅を管理する家の住民） ───────────
  mine: {
    id: 'mine',
    entries: [
      { when: inChapter('end'), node: 'end' },
      { when: all(inChapter('ch3'), fullKaya), node: 'ch3Lent' },
      { when: inChapter('ch3'), node: 'ch3' },
      { when: all(inChapter('roofDay'), fam('wait', 'waitHelp')), node: 'dayCutting' },
      { when: all(inChapter('roofDay'), fullKaya), node: 'dayLent' },
      { when: inChapter('roofDay'), node: 'dayOwn' },
      { when: flag('talked:mine'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'mine',
        lines: ['茅を借りに来たんだろう。顔に書いてあるよ。', '悪いけど、**はいどうぞとは言えない**ね。'],
        effects: [learn('mine.kaya', 'reluctant')],
        choices: [...MINE_TOPICS, { text: 'また来ます' }],
      },
      how: {
        speaker: 'mine',
        lines: ['うちだって**来年は屋根に茅を使う**んだ。', '貸したものが、いつ、どう返ってくるのか。**そこがはっきりしないとね**。'],
        effects: [learn('mine.kaya', 'returnTerms'), setConsent('mine', 'lendKaya', 'conditional', '返し方がはっきりすれば考える')],
        choices: [...MINE_TOPICS, { text: 'また来ます' }],
      },
      recordsAsk: {
        speaker: 'mine',
        lines: ['……控えを？ まあ、いいよ。茅置場の脇の棚にある。', '勝手に書き足したりはしないでおくれよ。'],
        effects: [setConsent('mine', 'showRecords', 'agreed')],
      },
      cutting: {
        speaker: 'mine',
        lines: [
          '宗平さんの茅刈りの段取りか。……**できなくはない**よ。',
          '茅刈りを仕切るなら、**新しい茅の当てもつく**。そうなりゃ、今ある茅を貸す余裕も出る。……ただ、うちの手は回らなくなるね。',
        ],
        effects: [learn('mine.cutting', 'canLead')],
        choices: [...MINE_TOPICS, { text: 'また来ます' }],
      },
      again: {
        speaker: 'mine',
        lines: ['茅のことなら、話はまだ終わってないよ。'],
        choices: [...MINE_TOPICS, { text: '失礼します' }],
      },

      // 計画の相談（茅を借りる・宗平の茅刈りを代わってもらう案のとき）
      planConsult: {
        lines: ['（作業台でまとめた案を、ミネさんに話した。）'],
        choices: [{ text: 'この案でお願いできますか', effects: [consultPlan('mine')], next: 'planReact' }, { text: 'やっぱり考え直します' }],
      },
      planReact: {
        lines: ['ミネさんは腕を組んだ。'],
        branches: [
          { when: planReason('mine', 'wantsKaya'), next: 'reWantsKaya' },
          { when: planReason('mine', 'wantsRecord'), next: 'reWantsRecord' },
          { when: planReason('mine', 'moreKaya'), next: 'reMoreKaya' },
          { when: planReason('mine', 'coverAndLend'), next: 'reCoverAndLend' },
          { when: planReason('mine', 'lendRecorded'), next: 'reLend' },
          { when: planReason('mine', 'coverOnly'), next: 'reCoverOnly' },
        ],
      },
      reWantsKaya: {
        speaker: 'mine',
        lines: ['手伝いで返すって？ ……**うちが要るのは茅**なんだよ。', '来年はうちの屋根にも使う。返すなら、茅で返しておくれ。'],
        effects: [learn('mine.kaya', 'returnTerms')],
      },
      reWantsRecord: {
        speaker: 'mine',
        lines: ['茅で返すのはいい。でも、**口約束じゃ困る**ね。', '前にそれで揉めたことがあってね。……うちの控えを見てごらん。茅置場の脇の棚だよ。'],
        effects: [setConsent('mine', 'showRecords', 'agreed')],
      },
      reMoreKaya: {
        speaker: 'mine',
        lines: ['待てば傷みが広がって、**もっと要る**だろう？', '今のうちの蓄えじゃ、その量は貸せないよ。'],
      },
      reCoverAndLend: {
        speaker: 'mine',
        lines: [
          '茅刈りを仕切るなら、新しい茅の当てがつく。**それなら今の茅も貸せる**。',
          '……ただ、これはうちにとっても大仕事だよ。宗平さんには、覚えておいてもらわないと。',
        ],
        effects: [learn('mine.cutting', 'canLead')],
      },
      reLend: {
        speaker: 'mine',
        lines: ['来年の秋、同じ束数を茅で返す。**結帳に書き残す**。', '……それなら貸すよ。'],
      },
      reCoverOnly: {
        speaker: 'mine',
        lines: ['茅刈りの段取りなら引き受けるよ。', '茅は借りないんだね？ 手持ちでやりくりするなら、それもひとつのやり方さ。'],
      },

      // 屋根葺き当日
      dayLent: {
        speaker: 'mine',
        lines: ['茅は運び込んだよ。', '**来年の秋、記したとおり返しておくれ**。'],
      },
      dayCutting: {
        speaker: 'mine',
        lines: ['これから茅場さ。**宗平さんの分まで、ひと仕事**だよ。', '屋根のほうは、宗平さんに任せた。'],
      },
      dayOwn: {
        speaker: 'mine',
        lines: ['今回は借りに来なかったね。', '手持ちでやりくりするのも、ひとつのやり方さ。'],
      },

      // 第3幕
      ch3Lent: {
        speaker: 'mine',
        lines: [
          '三年前の茅は、**記したとおり翌年返してもらった**よ。ああいうのが一番いい。',
          '伊助さんの屋根の茅は、うちのを回すことになってる。……ちゃんと記すよ。',
        ],
      },
      ch3: {
        speaker: 'mine',
        lines: ['三年前は、うちに茅を借りに来なかったね。', '伊助さんの屋根の茅は、うちのを回すことになってる。……ちゃんと記すよ。'],
      },

      end: {
        speaker: 'mine',
        lines: ['伊助さんの屋根のことも、片がついたね。', '何をしたか、何がまだか。記しておけば、あとで話し合える。'],
      },
    },
  },

  // ─────────── 調べられるもの ───────────
  saeRoof: {
    id: 'saeRoof',
    entries: [
      { when: all(inChapter('ch3', 'end'), knows('sae.roof', 'renewed')), node: 'renewed' },
      { when: inChapter('ch3', 'end'), node: 'partialLater' },
      { when: inChapter('roofDay'), node: 'working' },
      { when: flag('inspected:saeRoof'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        lines: [
          'サエさんの家の茅葺き屋根。',
          '近くで見ると、茅が黒ずんで薄くなっているところがある。葺き替えが必要なのは本当らしい。',
        ],
        effects: [learn('sae.roof', 'worn')],
      },
      again: { lines: ['傷んだ茅葺き屋根。葺き替えの日を待っている。'] },
      renewed: { lines: ['三年前に葺き替えた南面。まだ茅の色が明るい。'] },
      partialLater: { lines: ['三年前に葺き替えたのは、傷みのひどい所だけだ。**残りはまだ古い茅のまま**だ。'] },
      working: { lines: ['屋根の上で、人が茅を葺いている。縄を締める音が響く。'] },
    },
  },
  hasaRack: {
    id: 'hasaRack',
    entries: [
      { when: inChapter('ch3', 'end'), node: 'later' },
      { when: all(inChapter('roofDay'), fam('wait', 'waitHelp')), node: 'done' },
      { when: all(knows('isuke.availability', 'harvest'), notYet('isuke.field', 'progress')), node: 'closer' },
      { when: flag('inspected:hasaRack'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        lines: [
          '木の柵に、刈り取った稲の束がずらりと掛けられている。',
          'まだ半分ほどしか掛かっていない。刈り入れの真っ最中のようだ。',
        ],
        effects: [learn('isuke.field', 'harvesting')],
      },
      closer: {
        lines: [
          'はさの向こうに、刈り取りを待つ田がまだ広がっている。',
          '伊助さんひとりでは、**あと十日はかかりそうだ**。人手があれば、もっと早く済むかもしれない。',
        ],
        effects: [learn('isuke.field', 'progress')],
      },
      again: { lines: ['稲の束が掛けられた柵。刈り入れはまだ続くようだ。'] },
      done: { lines: ['はさ掛けに、稲がすべて掛け終わっている。刈り入れは済んだようだ。'] },
      later: { lines: ['三年後の秋。今年も、はさ掛けに稲が掛かり始めている。'] },
    },
  },
  kayaBundles: {
    id: 'kayaBundles',
    entries: [{ node: 'first' }],
    nodes: {
      first: {
        lines: ['よく乾いた茅の束が積まれている。', 'これだけあっても、大きな屋根一軒分には足りないのだろうか。'],
      },
    },
  },
  planTable: {
    id: 'planTable',
    entries: [
      { when: all(inChapter('ch3'), planPhase('decided')), node: 'decided3' },
      { when: all(inChapter('ch3'), knows('isuke.roof3')), node: 'open3' },
      { when: inChapter('ch3'), node: 'notYet3' },
      { when: inChapter('end'), node: 'decided3' },
      { when: planPhase('decided'), node: 'decided' },
      { when: knows('sae.schedule'), node: 'open' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        lines: [
          '宗平さんの作業台。大きな紙が広げられているが、まだ何も書かれていない。',
          '屋根葺きをする家の話を聞いてから、ここで段取りを考えることになりそうだ。',
        ],
      },
      open: { lines: ['宗平さんの作業台。大きな紙に、屋根葺きの段取りを書きつけられる。'] },
      decided: { lines: ['作業台の紙に、決めた段取りが書きつけてある。'] },
      open3: { lines: ['宗平さんの作業台。今度は、伊助家の屋根葺きの段取りを書きつける。'] },
      notYet3: { lines: ['宗平さんの作業台。**まず伊助さんの話を聞いてから**考えよう。'] },
      decided3: { lines: ['作業台の紙に、伊助家の屋根葺きの段取りが書きつけてある。'] },
    },
  },
  ledger: {
    id: 'ledger',
    entries: [{ when: knows('ledger.basics', 'read'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        lines: [
          '囲炉裏の奥の棚の文箱に、表に「結帳」と書かれた古い帳面がしまってある。',
          'サエ家の屋根葺きで、誰が何をしたかの記録らしい。開いてみよう。',
        ],
        effects: [learn('ledger.basics', 'read'), learn('isuke.pastHelp', 'onRecord')],
      },
      again: { lines: ['サエ家の結帳を開く。'] },
    },
  },
  // ── サエ家の入口と室内（Phase 5.5）──
  saeDoor: {
    id: 'saeDoor',
    entries: [{ when: SAE_HOUSE_OPEN, node: 'enter' }, { node: 'closed' }],
    nodes: {
      enter: { lines: ['戸を開けて、サエ家に上がる。'] },
      closed: {
        lines: ['サエ家の入口。戸は閉まっている。', '（人の家だ。**サエさんに断ってから**入ろう。）'],
      },
    },
  },
  saeDoorInside: {
    id: 'saeDoorInside',
    entries: [{ node: 'leave' }],
    nodes: {
      leave: { lines: ['戸を開けて、外に出る。'] },
    },
  },
  irori: {
    id: 'irori',
    entries: [{ node: 'look' }],
    nodes: {
      look: {
        lines: [
          '囲炉裏に、小さく火が残っている。上には、煤で黒くなった板が吊るしてある。',
          '火の粉が天井へ上がらないようにするものらしい。煙は格子の天井のすき間から、上の暗がりへ抜けていく。',
        ],
      },
    },
  },
  mineRecords: {
    id: 'mineRecords',
    entries: [{ when: consentIs('mine', 'showRecords', 'agreed'), node: 'read' }, { node: 'refuse' }],
    nodes: {
      read: {
        lines: [
          'ミネ家の貸し借りの控え。茅の束数と相手の家が、年ごとに書きつけてある。',
          '九年前の欄に「茅二十束 貸す」とある。返しの欄は空いたままで、余白に「先方は返したと言う」と小さく書き添えてある。',
          '（返し方を決めないまま貸して、互いの覚えが食い違ったのだろうか。）',
        ],
        effects: [learn('mine.kaya', 'whyRecord')],
      },
      refuse: {
        lines: ['棚に、ミネ家の帳面が置いてある。', '（人の家の控えだ。ミネさんに断らずに読むわけにはいかない。）'],
      },
    },
  },
};
