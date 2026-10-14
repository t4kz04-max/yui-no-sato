import type { PersonAppearance } from '../characters/personRig';
import type { PoseStyle } from '../characters/poses';

/**
 * 登場人物（設計書 D 節）。全員が架空の人物で、実在の白川村の住民をモデルにしたものではない。
 *
 * 見た目（docs/PHASE5_ART.md §3）：名前のある 5 人と主人公は、色相の違う服（藍・青緑・赤茶・浅葱・墨・葡萄）と、
 * かぶり物・上着の丈・持ち物のシルエットで見分けられるようにする。背景（草地・茅・木・紅葉）の色とは重ねない。
 * 服装は時代を特定しない素朴な野良着の形（村の時代設定は未確定）。
 */
export type CharacterId = 'toki' | 'sae' | 'isuke' | 'sohei' | 'mine';

export interface CharacterDef {
  readonly id: CharacterId;
  readonly name: string;
  /** 立場（設計書 D 節）。デバッグ・今後の手帳表示用。 */
  readonly role: string;
  readonly appearance: PersonAppearance;
  /** 普段の立ち姿（待機の型）。 */
  readonly idle: PoseStyle;
}

const SKIN = 0xf0cfb0;

export const CHARACTERS: Readonly<Record<CharacterId, CharacterDef>> = {
  toki: {
    id: 'toki',
    name: 'トキ',
    role: '村の若い手伝い',
    // 小柄、青緑の上着に白い鉢巻とたすき。体重を左右に移して落ち着かない
    appearance: {
      cloth: 0x2e8a80,
      limb: 0x2b3a3a,
      skin: SKIN,
      hair: 0x2a1d14,
      headwear: 'band',
      headwearColor: 0xf2eee2,
      tasuki: 0xf2eee2,
      sash: 0x1f3a38,
      height: 0.88,
    },
    idle: 'fidget',
  },
  sae: {
    id: 'sae',
    name: 'サエ',
    role: '屋根葺きを控えた家の家主',
    // 赤茶の着物に紺の前掛け、白い手ぬぐい。手を前で重ねる
    appearance: {
      cloth: 0xa0402e,
      limb: 0x4a2a22,
      skin: SKIN,
      hair: 0x1f1a17,
      headwear: 'kerchief',
      headwearColor: 0xeee8da,
      coat: 'long',
      apron: 0x26314d,
      sash: 0x3a2a24,
      hairStyle: 'bun',
      height: 0.94,
    },
    idle: 'handsFront',
  },
  isuke: {
    id: 'isuke',
    name: '伊助',
    role: '畑仕事を営む隣家の住民',
    // 浅葱の野良着、幅広の麦わら帽子、背負い籠、白い脚絆。畑の方を気にしている
    appearance: {
      cloth: 0x5f93ad,
      limb: 0x34485a,
      skin: 0xe2b896,
      hair: 0x1a1a1a,
      headwear: 'wideStraw',
      headwearColor: 0xd4b868,
      pack: 'basket',
      leggings: 0xe6e0d0,
      sash: 0x3a3a34,
      height: 1.03,
    },
    idle: 'lookField',
  },
  sohei: {
    id: 'sohei',
    name: '宗平',
    role: '経験ある世話役',
    // がっしりした体格、膝まである墨色の上着、白髪とひげ。腕を組む
    appearance: {
      cloth: 0x2e2c2b,
      limb: 0x24211f,
      skin: 0xe6c3a2,
      hair: 0xb8b2a8,
      headwear: 'none',
      coat: 'long',
      sash: 0x8a7a5a,
      collar: 0x9a948a,
      beard: true,
      build: 1.14,
      height: 1.02,
    },
    idle: 'armsCrossed',
  },
  mine: {
    id: 'mine',
    name: 'ミネ',
    role: '茅を管理する家の住民',
    // 葡萄色の上着に茶の手ぬぐいと前掛け。帳面を胸元に持つ
    appearance: {
      cloth: 0x6c4466,
      limb: 0x3a2a38,
      skin: SKIN,
      hair: 0x2b2420,
      headwear: 'kerchief',
      headwearColor: 0x9a7650,
      apron: 0x8a7458,
      sash: 0x2a2228,
      height: 0.96,
    },
    idle: 'holdBook',
  },
};

/** 屋根葺きの日に手伝いに来る、名前のない村の人たち（くすんだ色にして、名前のある住民より目立たせない）。 */
export const VILLAGER_LOOKS: readonly PersonAppearance[] = [
  { cloth: 0x6e6452, limb: 0x3a3428, skin: 0xe6c3a2, hair: 0x1a1a1a, headwear: 'kerchief', headwearColor: 0xc8c0b0, sash: 0x3a3428 },
  { cloth: 0x5a5e52, limb: 0x2f3228, skin: 0xe2b896, hair: 0x2a2018, headwear: 'straw', headwearColor: 0xa8935e, leggings: 0xb8b0a0 },
  { cloth: 0x655548, limb: 0x352c26, skin: 0xf0cfb0, hair: 0x1f1a17, headwear: 'band', headwearColor: 0xc8c0b0, tasuki: 0xb8b0a0 },
  { cloth: 0x5c5a5e, limb: 0x2e2c30, skin: 0xe6c3a2, hair: 0x5a554e, headwear: 'none', sash: 0x6a5a48 },
  { cloth: 0x6a5e4c, limb: 0x3a3226, skin: 0xe2b896, hair: 0x1a1a1a, headwear: 'kerchief', headwearColor: 0x8a7a62, apron: 0x4a4438 },
  { cloth: 0x585a4e, limb: 0x30302a, skin: 0xf0cfb0, hair: 0x2a2018, headwear: 'straw', headwearColor: 0xa08a58 },
  { cloth: 0x625448, limb: 0x332a24, skin: 0xe6c3a2, hair: 0x3a3430, headwear: 'band', headwearColor: 0xb8b0a0 },
];
