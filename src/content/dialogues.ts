import type { DialogueScript } from '../dialogue/types';
import { all, flag, not, setFlag } from '../story/conditions';

/**
 * 会話・調査のデータ（Phase 1 の動作確認用の仮の台詞）。
 *
 * - 本編のシナリオ・最終的な台詞は Phase 3〜4 で確定する。ここにあるのは設計書 D・G 節の
 *   「最初の印象」に沿った短い仮の台詞と、仕組みを確認するための最小限の分岐だけ。
 * - 人物・村・出来事はすべて創作。史実の説明は含めない（史実の説明は出典を確認したうえで別途扱う）。
 * - 「調べる → 選択肢が増える → 事情が分かる」の流れを、伊助とはさ掛けで1つだけ用意している。
 *
 * フラグ：`talked:<id>` / `inspected:<id>` は会話・調査を終えると自動で立つ。
 *         `fact:<name>` はプレイヤーが知った事情。
 */
export const DIALOGUES: Readonly<Record<string, DialogueScript>> = {
  // ─────────── トキ（気さくな案内役） ───────────
  toki: {
    id: 'toki',
    entries: [
      { when: flag('fact:isukeHarvest'), node: 'afterHarvest' },
      { when: all(flag('talked:isuke'), not(flag('fact:isukeHarvest'))), node: 'hintIsuke' },
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
          '見ただけじゃ分からないことも多いから、いろいろ調べてみて。',
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
        choices: [
          { text: '誰に声をかければいいですか？', next: 'who' },
          { text: '日取りは動かせないんですか？', next: 'date' },
        ],
      },
      date: {
        speaker: 'sae',
        lines: ['……できれば、今の日取りで進めたいの。'],
        next: 'dateThought',
      },
      dateThought: {
        lines: ['（何か事情がありそうだ。今は深く聞かないでおこう。）'],
        next: 'who',
      },
      who: {
        speaker: 'sae',
        lines: [
          '隣の伊助さん、作業場の宗平さん、それに茅のことならミネさんね。',
          'みんな忙しい時期だから、無理は言えないんだけど。',
        ],
      },
      again: {
        speaker: 'sae',
        lines: ['伊助さん、宗平さん、ミネさん。話を聞いてきてくれる？'],
      },
    },
  },

  // ─────────── 伊助（協力を断る隣家の住民） ───────────
  isuke: {
    id: 'isuke',
    entries: [
      { when: flag('fact:isukeHarvest'), node: 'afterHarvest' },
      { when: flag('talked:isuke'), node: 'again' },
      { node: 'first' },
    ],
    nodes: {
      first: {
        speaker: 'isuke',
        lines: ['屋根葺きの手伝い？ ……悪いが、その日は無理だ。'],
        choices: [
          { text: 'どうしてですか？', next: 'why' },
          // 畑のはさ掛けを調べた後だけ出る選択肢
          { text: '畑のはさ掛けを見てきました', when: flag('inspected:hasaRack'), next: 'harvest' },
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
          { text: '畑のはさ掛けを見てきました', when: flag('inspected:hasaRack'), next: 'harvest' },
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
        effects: [setFlag('fact:isukeHarvest')],
      },
      afterHarvest: {
        speaker: 'isuke',
        lines: ['刈り入れが済むまでは、こっちも手一杯だ。……悪く思わんでくれ。'],
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
      },
      again: {
        speaker: 'sohei',
        lines: ['皆の都合は聞けたか。急がんでいい、聞き漏らしのないようにな。'],
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
          '悪いけど、はいどうぞとは言えないね。うちの屋根にだって、いずれ要るものなんだから。',
        ],
        choices: [{ text: 'どうしたら貸してもらえますか？', next: 'how' }, { text: 'また来ます' }],
      },
      how: {
        speaker: 'mine',
        lines: ['さあね。貸したものが、いつ、どう返ってくるのか。そこがはっきりしないとね。'],
      },
      again: {
        speaker: 'mine',
        lines: ['茅のことなら、話はまだ終わってないよ。'],
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
};
