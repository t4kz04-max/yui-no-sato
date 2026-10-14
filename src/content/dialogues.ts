import type { DialogueChoice, DialogueScript } from '../dialogue/types';
import {
  all,
  consentIs,
  consultPlan,
  flag,
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

/** サエに聞けること（会話の中で何度でも戻ってくる一覧）。 */
const SAE_TOPICS: readonly DialogueChoice[] = [
  { text: '作業台でまとめた案を相談する', when: planPending('sae'), next: 'planConsult' },
  { text: '日取りは動かせないんですか？', when: notYet('sae.dateReason', 'hesitant'), next: 'date' },
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
    when: all(notYet('ledger.basics', 'read'), not(flag('asked:saeLedger'))),
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
      { when: outcomeIs('r1'), node: 'epiR1' },
      { when: outcomeIs('r2'), node: 'epiR2' },
      { when: outcomeIs('r3', 'r3help'), node: 'epiR3' },
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
          'サエさんの家の縁先に、結帳が置いてあるはずだよ。',
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
      epiR1: {
        speaker: 'toki',
        lines: [
          '伊助さん、刈り入れに集中できてよかったって。',
          'でも、屋根葺きを畑から見てるのは、ちょっと寂しかったみたい。同じことでも、人によって受け取り方が違うんだね。',
        ],
      },
      epiR2: {
        speaker: 'toki',
        lines: ['前の日の伊助さん、すごく手際がよかったよ。', '今度はサエさんの家が刈り入れを手伝う番だね。約束、忘れないようにしないと。'],
      },
      epiR3: {
        speaker: 'toki',
        lines: ['待った分、屋根は傷んじゃったけど、みんなそろって葺けたね。', 'どっちがよかったのかは、ぼくにも分からないや。'],
      },
    },
  },

  // ─────────── サエ（屋根葺きを控えた家の家主） ───────────
  sae: {
    id: 'sae',
    entries: [
      { when: outcomeIs('r1'), node: 'epiR1' },
      { when: outcomeIs('r2'), node: 'epiR2' },
      { when: outcomeIs('r3', 'r3help'), node: 'epiR3' },
      { when: flag('talked:sae'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'sae',
        lines: [
          'あら、あなたが相談役を引き受けてくれたのね。',
          '屋根の葺き替え、日取りはもう決めてあるの。でも、手伝ってもらえる人がなかなか揃わなくて……。',
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
        lines: ['ええ……。今年のうちに葺き替えないと、傷みが中まで進んでしまうの。', 'だから、日取りはできるだけ延ばしたくないのよ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
        next: 'more',
      },
      burden: {
        speaker: 'sae',
        lines: [
          '……そうなの。うちはまだ返せていない。',
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
        lines: ['ええ、縁先の文箱に入ってるわ。うちの屋根葺きで誰に何をしてもらったか、書いてあるはずよ。'],
        effects: [setFlag('asked:saeLedger')],
        next: 'more',
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
        lines: ['伊助さんに無理を言わずに済むなら、それがいいのかもしれない。', '人手は少ないけれど、うちの者と村の人たちで、なんとかするわ。'],
      },
      reRelies: {
        speaker: 'sae',
        lines: [
          '……また伊助さんに頼ることになるのね。',
          'うちは十二年前の分も、まだ返せていないのに。……でも、あなたがそう考えたのなら、それでいいわ。',
        ],
        effects: [learn('isuke.pastHelp', 'onRecord'), learn('sae.dateReason', 'burden')],
      },
      reWithReturn: {
        speaker: 'sae',
        lines: ['伊助さんの刈り入れに、うちからも人を出すのね。', 'うちも楽ではないけれど、頼むだけというのは気が引けるもの。それでいきましょう。'],
        effects: [learn('sae.dateReason', 'burden')],
      },
      reDelayNo: {
        speaker: 'sae',
        lines: ['伊助さんが当日来られないのに、延ばすの？', '待つあいだにも屋根は傷むのよ。それなら、予定どおりにやりたいわ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
      },
      reDelayWorry: {
        speaker: 'sae',
        lines: ['刈り入れの後まで延ばすのね……。', '待てば傷みは進む。それでも、伊助さんが来てくれるなら……分かったわ。'],
        effects: [learn('sae.dateReason', 'roofWorry')],
      },
      reDelayReturn: {
        speaker: 'sae',
        lines: ['延ばして、待つあいだに伊助さんの刈り入れを手伝うのね。', '傷みは心配だけれど、そのほうが筋が通る気がする。やってみましょう。'],
        effects: [learn('sae.dateReason', 'burden')],
      },

      // 結果の後
      epiR1: {
        speaker: 'sae',
        lines: ['屋根、葺き上がったわ。二日がかりだったけれど。', '伊助さんに無理を言わずに済んだのは、よかったのかしらね。'],
      },
      epiR2: {
        speaker: 'sae',
        lines: ['一日で葺き上がったの。伊助さんの前の日の手伝いのおかげね。', '今度はうちが刈り入れを手伝う番。約束は守らないと。'],
      },
      epiR3: {
        speaker: 'sae',
        lines: ['待った分、傷んだところも多かったけれど……みんなで葺けたわ。', 'これでよかったのか、ときどき考えるの。'],
      },
    },
  },

  // ─────────── 伊助（協力を断る隣家の住民） ───────────
  isuke: {
    id: 'isuke',
    entries: [
      { when: all(outcomeIs('r1'), knows('isuke.availability')), node: 'epiR1' },
      { when: outcomeIs('r1'), node: 'epiR1Unasked' },
      { when: outcomeIs('r2'), node: 'epiR2' },
      { when: outcomeIs('r3'), node: 'epiR3' },
      { when: outcomeIs('r3help'), node: 'epiR3help' },
      { when: knows('isuke.availability', 'harvest'), node: 'afterHarvest' },
      { when: flag('talked:isuke'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'isuke',
        lines: ['屋根葺きの手伝い？ ……悪いが、その日は無理だ。'],
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
          '……見たのか。ちょうど稲の刈り入れが重なっていてな。',
          '天気のいいうちに刈って掛けてしまわんと、うちの一年の米が駄目になる。屋根の日にここを空けるわけにはいかん。',
        ],
        next: 'harvestNote',
      },
      harvestNote: {
        lines: ['（伊助さんが断ったのは、屋根葺きの日が稲の刈り入れと重なるからだった。）'],
        effects: [learn('isuke.availability', 'harvest')],
      },
      dayBefore: {
        speaker: 'isuke',
        lines: ['……前の日の半日くらいなら、抜けられんこともない。', 'だが、その分刈り入れは遅れる。遅れをどうするか、だな。'],
        effects: [learn('isuke.availability', 'dayBefore')],
      },
      pastHelp: {
        speaker: 'isuke',
        lines: [
          '十二年前……ああ、サエさんの家の時か。確かに手伝いに出た。',
          'だがな、昔手伝ったからといって、今年の刈り入れが待ってくれるわけじゃない。返してもらうのは、いずれうちの屋根の時でいい。',
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
        lines: ['刈り入れの日に屋根には上がれん。それは前にも話したはずだ。', '日取りか、頼み方か……どちらかを変えてくれんと、どうにもならん。'],
      },
      reConflict: {
        speaker: 'isuke',
        lines: ['その日は無理だと言ったろう。こっちにも都合がある。'],
      },
      reNeedsCover: {
        speaker: 'isuke',
        lines: [
          '前の日の半日か……。抜けられんことはない。',
          'だが、その分刈り入れが遅れる。遅れた分をどうするのか。そこが決まらんうちは、うんとは言えん。',
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

      // 結果の後
      epiR1: {
        speaker: 'isuke',
        lines: ['屋根、葺き上がったな。……うちは刈り入れで手一杯だった。', '手伝えんで悪かったとは思っとる。だが、あれでよかったんだろう。'],
      },
      epiR1Unasked: {
        speaker: 'isuke',
        lines: ['サエさんの屋根、葺き替わったな。', 'うちは刈り入れで手一杯で、それどころじゃなかった。'],
      },
      epiR2: {
        speaker: 'isuke',
        lines: ['前の日の分は、刈り入れを手伝ってもらうことで話がついとる。', '約束は約束だ。頼んだぞ。'],
      },
      epiR3: {
        speaker: 'isuke',
        lines: ['待たせたな。屋根の上は久しぶりだったが、悪くなかった。', '……だが、サエさんの屋根、思ったより傷んどったな。'],
      },
      epiR3help: {
        speaker: 'isuke',
        lines: ['刈り入れを手伝ってもらって助かった。おかげで早く片づいた。', '屋根の日に出られてよかったよ。'],
      },
    },
  },

  // ─────────── 宗平（経験ある世話役） ───────────
  sohei: {
    id: 'sohei',
    entries: [
      { when: planPhase('decided'), node: 'afterDecision' },
      { when: all(flag('talked:sohei'), planPhase('revise')), node: 'planRevise' },
      { when: flag('talked:sohei'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'sohei',
        lines: [
          'お前さんが相談役か。宗平だ。',
          '屋根葺きは、人を集めれば済む話じゃない。誰がどの役目を受け持つか、段取りが要る。',
          'まずは皆の都合を聞いてこい。計画を立てるのはそれからだ。',
        ],
        effects: [learn('sohei.roles', 'roles')],
        choices: [
          { text: '宗平さんは当日来られますか？', when: consentIs('sohei', 'roofDay', 'none'), next: 'canCome' },
          { text: '分かりました' },
        ],
      },
      canCome: {
        speaker: 'sohei',
        lines: [
          '予定の日なら行ける。',
          'ただ、わしにも動かせん用事のある日がある。日取りを動かす話になったら、先に言ってくれ。',
        ],
        effects: [
          learn('sohei.schedule', 'hasConflict'),
          setConsent('sohei', 'roofDay', 'conditional', '予定日なら来られる'),
        ],
      },
      planRevise: {
        speaker: 'sohei',
        lines: [
          '返事が割れたか。誰が、何を理由に首を振ったのか、よく考えることだ。',
          '紙は何度でも書き直せる。だが、人に無理を通すための書き直しはするなよ。',
        ],
      },
      afterDecision: {
        speaker: 'sohei',
        lines: ['段取りは決まったな。', '決めたことがどう転んだか、最後まで見届けるのも相談役の仕事だ。'],
      },
      again: {
        speaker: 'sohei',
        lines: ['皆の都合は聞けたか。急がんでいい、聞き漏らしのないようにな。'],
        choices: [
          { text: '宗平さんは当日来られますか？', when: consentIs('sohei', 'roofDay', 'none'), next: 'canCome' },
          { text: '失礼します' },
        ],
      },
    },
  },

  // ─────────── ミネ（茅を管理する家の住民） ───────────
  mine: {
    id: 'mine',
    entries: [{ when: flag('talked:mine'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        speaker: 'mine',
        lines: [
          '茅を借りに来たんだろう。顔に書いてあるよ。',
          '悪いけど、はいどうぞとは言えないね。',
        ],
        effects: [learn('mine.kaya', 'reluctant')],
        choices: [
          { text: 'どうしたら貸してもらえますか？', when: notYet('mine.kaya', 'returnTerms'), next: 'how' },
          {
            text: '貸し借りの控えを見せてもらえますか？',
            when: all(knows('mine.kaya', 'returnTerms'), consentIs('mine', 'showRecords', 'none')),
            next: 'recordsAsk',
          },
          { text: 'また来ます' },
        ],
      },
      how: {
        speaker: 'mine',
        lines: [
          'うちだって来年は屋根に茅を使うんだ。',
          '貸したものが、いつ、どう返ってくるのか。そこがはっきりしないとね。',
        ],
        effects: [
          learn('mine.kaya', 'returnTerms'),
          setConsent('mine', 'lendKaya', 'conditional', '返し方がはっきりすれば考える'),
        ],
        choices: [
          {
            text: '貸し借りの控えを見せてもらえますか？',
            when: consentIs('mine', 'showRecords', 'none'),
            next: 'recordsAsk',
          },
          { text: 'また来ます' },
        ],
      },
      recordsAsk: {
        speaker: 'mine',
        lines: ['……控えを？ まあ、いいよ。茅置場の脇の棚にある。', '勝手に書き足したりはしないでおくれよ。'],
        effects: [setConsent('mine', 'showRecords', 'agreed')],
      },
      again: {
        speaker: 'mine',
        lines: ['茅のことなら、話はまだ終わってないよ。'],
        choices: [
          { text: 'どうしたら貸してもらえますか？', when: notYet('mine.kaya', 'returnTerms'), next: 'how' },
          {
            text: '貸し借りの控えを見せてもらえますか？',
            when: all(knows('mine.kaya', 'returnTerms'), consentIs('mine', 'showRecords', 'none')),
            next: 'recordsAsk',
          },
          { text: '失礼します' },
        ],
      },
    },
  },

  // ─────────── 調べられるもの ───────────
  saeRoof: {
    id: 'saeRoof',
    entries: [
      { when: knows('sae.roof', 'renewed'), node: 'renewed' },
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
      renewed: { lines: ['葺き替えたばかりの屋根。新しい茅の色が明るい。'] },
    },
  },
  hasaRack: {
    id: 'hasaRack',
    entries: [
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
          '伊助さんひとりでは、あと十日はかかりそうだ。人手があれば、もっと早く済むかもしれない。',
        ],
        effects: [learn('isuke.field', 'progress')],
      },
      again: { lines: ['稲の束が掛けられた柵。刈り入れはまだ続くようだ。'] },
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
    },
  },
  ledger: {
    id: 'ledger',
    entries: [{ when: knows('ledger.basics', 'read'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        lines: [
          '縁先の文箱に、表に「結帳」と書かれた古い帳面がしまってある。',
          'サエ家の屋根葺きで、誰が何をしたかの記録らしい。開いてみよう。',
        ],
        effects: [learn('ledger.basics', 'read'), learn('isuke.pastHelp', 'onRecord')],
      },
      again: { lines: ['サエ家の結帳を開く。'] },
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
