import type { DialogueScript } from '../dialogue/types';
import { all, consentIs, flag, knows, learn, notYet, setConsent } from '../story/conditions';

/**
 * 会話・調査のデータ（仮の台詞）。どの選択肢で何が変わるかは docs/STATE_TABLE.md 第5節と対応する。
 *
 * - 本編のシナリオ・最終的な台詞は Phase 3〜4 で確定する。ここにあるのは設計書 D・G 節に沿った
 *   第1幕の情報収集の骨組みと、状態管理の仕組みを確認するための最小限の分岐だけ。
 * - 人物・村・出来事はすべて創作。史実の説明は含めない。
 * - 住民の「意向」（setConsent）は本人がはっきり表明したときだけ記録する。
 */
export const DIALOGUES: Readonly<Record<string, DialogueScript>> = {
  // ─────────── トキ（気さくな案内役） ───────────
  toki: {
    id: 'toki',
    entries: [
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
          'まずはサエさんに話を聞いてみたら？',
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
    },
  },

  // ─────────── サエ（屋根葺きを控えた家の家主） ───────────
  sae: {
    id: 'sae',
    entries: [{ when: flag('talked:sae'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        speaker: 'sae',
        lines: [
          'あら、あなたが相談役を引き受けてくれたのね。',
          '屋根の葺き替え、日取りはもう決めてあるの。でも、手伝ってもらえる人がなかなか揃わなくて……。',
        ],
        effects: [learn('sae.schedule', 'needsHelp')],
        choices: [
          { text: '誰に声をかければいいですか？', next: 'who' },
          { text: '日取りは動かせないんですか？', next: 'date' },
          { text: '結帳を見てもいいですか？', when: notYet('ledger.basics', 'read'), next: 'ledgerOk' },
        ],
      },
      date: {
        speaker: 'sae',
        lines: ['……できれば、今の日取りで進めたいの。'],
        next: 'dateThought',
      },
      dateThought: {
        lines: ['（何か事情がありそうだ。今は深く聞かないでおこう。）'],
        effects: [learn('sae.dateReason', 'hesitant')],
        next: 'who',
      },
      who: {
        speaker: 'sae',
        lines: [
          '隣の伊助さん、作業場の宗平さん、それに茅のことならミネさんね。',
          'みんな忙しい時期だから、無理は言えないんだけど。',
        ],
      },
      ledgerOk: {
        speaker: 'sae',
        lines: ['ええ、縁先の文箱に入ってるわ。うちの屋根葺きで誰に何をしてもらったか、書いてあるはずよ。'],
      },
      again: {
        speaker: 'sae',
        lines: ['伊助さん、宗平さん、ミネさん。話を聞いてきてくれる？'],
        choices: [
          { text: '日取りは動かせないんですか？', when: notYet('sae.dateReason', 'hesitant'), next: 'date' },
          { text: '結帳を見てもいいですか？', when: notYet('ledger.basics', 'read'), next: 'ledgerOk' },
          { text: '行ってきます' },
        ],
      },
    },
  },

  // ─────────── 伊助（協力を断る隣家の住民） ───────────
  isuke: {
    id: 'isuke',
    entries: [
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
        choices: [
          { text: 'どうしてですか？', next: 'why' },
          // 畑のはさ掛けを調べた後だけ出る選択肢
          {
            text: '畑のはさ掛けを見てきました',
            when: all(knows('isuke.field'), notYet('isuke.availability', 'harvest')),
            next: 'harvest',
          },
          // 結帳を読んだ後だけ出る選択肢
          {
            text: '十二年前、サエさんの家を手伝ったと結帳で見ました',
            when: all(knows('isuke.pastHelp'), notYet('isuke.pastHelp', 'isukeView')),
            next: 'pastHelp',
          },
          { text: '分かりました' },
        ],
      },
      why: {
        speaker: 'isuke',
        lines: ['こっちにも都合がある。それだけだ。'],
      },
      again: {
        speaker: 'isuke',
        lines: ['まだ何か用か。その日は無理だと言ったろう。'],
        choices: [
          {
            text: '畑のはさ掛けを見てきました',
            when: all(knows('isuke.field'), notYet('isuke.availability', 'harvest')),
            next: 'harvest',
          },
          {
            text: '十二年前、サエさんの家を手伝ったと結帳で見ました',
            when: all(knows('isuke.pastHelp'), notYet('isuke.pastHelp', 'isukeView')),
            next: 'pastHelp',
          },
          { text: '失礼しました' },
        ],
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
        choices: [
          {
            text: '十二年前、サエさんの家を手伝ったと結帳で見ました',
            when: all(knows('isuke.pastHelp'), notYet('isuke.pastHelp', 'isukeView')),
            next: 'pastHelp',
          },
          { text: 'お邪魔しました' },
        ],
      },
    },
  },

  // ─────────── 宗平（経験ある世話役） ───────────
  sohei: {
    id: 'sohei',
    entries: [{ when: flag('talked:sohei'), node: 'again' }, { node: 'first' }],
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
    entries: [{ when: flag('inspected:saeRoof'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        lines: [
          'サエさんの家の茅葺き屋根。',
          '近くで見ると、茅が黒ずんで薄くなっているところがある。葺き替えが必要なのは本当らしい。',
        ],
        effects: [learn('sae.roof', 'worn')],
      },
      again: { lines: ['傷んだ茅葺き屋根。葺き替えの日を待っている。'] },
    },
  },
  hasaRack: {
    id: 'hasaRack',
    entries: [{ when: flag('inspected:hasaRack'), node: 'again' }, { node: 'first' }],
    nodes: {
      first: {
        lines: [
          '木の柵に、刈り取った稲の束がずらりと掛けられている。',
          'まだ半分ほどしか掛かっていない。刈り入れの真っ最中のようだ。',
        ],
        effects: [learn('isuke.field', 'harvesting')],
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
    entries: [{ node: 'first' }],
    nodes: {
      first: {
        lines: [
          '宗平さんの作業台。大きな紙が広げられているが、まだ何も書かれていない。',
          '皆の都合が分かったら、ここで段取りを考えることになりそうだ。',
        ],
      },
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
