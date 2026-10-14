import type { PersonAppearance } from '../characters/personRig';

/**
 * 登場人物（設計書 D 節）。全員が架空の人物で、実在の白川村の住民をモデルにしたものではない。
 * 見た目は Phase 1 の仮モデル用（服の色・かぶり物で見分けられるようにしただけ）。
 */
export type CharacterId = 'toki' | 'sae' | 'isuke' | 'sohei' | 'mine';

export interface CharacterDef {
  readonly id: CharacterId;
  readonly name: string;
  /** 立場（設計書 D 節）。デバッグ・今後の手帳表示用。 */
  readonly role: string;
  readonly appearance: PersonAppearance;
}

const SKIN = 0xf0cfb0;

export const CHARACTERS: Readonly<Record<CharacterId, CharacterDef>> = {
  toki: {
    id: 'toki',
    name: 'トキ',
    role: '村の若い手伝い',
    appearance: { cloth: 0x6f8a4a, limb: 0x3b4a2c, skin: SKIN, hair: 0x2a1d14, headwear: 'none', height: 0.9 },
  },
  sae: {
    id: 'sae',
    name: 'サエ',
    role: '屋根葺きを控えた家の家主',
    appearance: {
      cloth: 0x9a5338,
      limb: 0x4a2d22,
      skin: SKIN,
      hair: 0x1f1a17,
      headwear: 'kerchief',
      headwearColor: 0xe9e3d3,
      height: 0.94,
    },
  },
  isuke: {
    id: 'isuke',
    name: '伊助',
    role: '畑仕事を営む隣家の住民',
    appearance: {
      cloth: 0x6b6440,
      limb: 0x3a3524,
      skin: 0xe2b896,
      hair: 0x1a1a1a,
      headwear: 'straw',
      headwearColor: 0xb0944e,
      height: 1.03,
    },
  },
  sohei: {
    id: 'sohei',
    name: '宗平',
    role: '経験ある世話役',
    appearance: { cloth: 0x3a3632, limb: 0x24211f, skin: 0xe6c3a2, hair: 0x9a958c, headwear: 'none', height: 1.0 },
  },
  mine: {
    id: 'mine',
    name: 'ミネ',
    role: '茅を管理する家の住民',
    appearance: {
      cloth: 0x4b5d70,
      limb: 0x2a3440,
      skin: SKIN,
      hair: 0x2b2420,
      headwear: 'kerchief',
      headwearColor: 0x8c6f4a,
      height: 0.96,
    },
  },
};
