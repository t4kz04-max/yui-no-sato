import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeldProp, JointPose } from './poses';

/**
 * 人物モデル（プレイヤー・住民・村の人たちで共通。docs/PHASE5_ART.md §3、docs/PHASE6_5_PLAN.md §2.4・§3）。
 *
 * Phase 6.5：全身を一つのスキンメッシュ（骨で動かすメッシュ）にまとめた。
 * - 部品はそれぞれ一本の骨に割り当てる（硬い部品のまま骨で動かす）。膝・顔（目・口・眉）の骨を足しても、
 *   一人あたりの描画は 1 回（従来は部位ごとに 8 回）。手に持つ物と足元の影は別の小さなメッシュ。
 * - 形：肩の丸み・胸と腰の絞り（回転体）、肘・手首・膝、親指のある手。
 * - 衣服：右前に重ねた襟と前の合わせ、袖口と広い袖、帯と後ろの結び目、裾の広がりと裾の縁。
 * - 顔：鼻・耳・眉・口。表情はまばたき・口の開き・眉の上がりだけ（控えめ。applyFace）。
 * - 服装は時代を特定しない素朴な野良着の形（村の時代設定は未確定）。
 * - 統一ルール：大きな面で輪郭を作る（分割は 8〜12）。全員一つのマテリアル（頂点色）。布の違いは明暗で表す。
 *
 * ローカル座標：顔は +Z を向く。左手は +X 側。足元が原点。
 */
export type Headwear = 'straw' | 'wideStraw' | 'kerchief' | 'band' | 'none';

export interface PersonAppearance {
  /** 上着の色。 */
  readonly cloth: number;
  /** 下衣・脚の色。 */
  readonly limb: number;
  readonly skin: number;
  readonly hair: number;
  readonly headwear: Headwear;
  /** かぶり物の色。 */
  readonly headwearColor?: number;
  /** 背丈の倍率。 */
  readonly height?: number;
  /** 肩幅・胴回りの倍率。 */
  readonly build?: number;
  /** 上着の丈：short＝腰まで、long＝膝まで（着物・長い上着）。 */
  readonly coat?: 'short' | 'long';
  /** 帯・腰ひもの色。 */
  readonly sash?: number;
  /** 前掛けの色。 */
  readonly apron?: number;
  /** たすき（袖をまとめるひも）の色。 */
  readonly tasuki?: number;
  /** 襟の色。 */
  readonly collar?: number;
  /** 背負い物：basket＝背負い籠、bag＝肩掛けの袋。 */
  readonly pack?: 'basket' | 'bag';
  /** 脚絆（すねに巻く布）の色。 */
  readonly leggings?: number;
  readonly hairStyle?: 'short' | 'bun';
  readonly beard?: boolean;
  /** 眉の形：soft＝やわらかい、stern＝きりっと（人物の印象。Phase 6.5）。 */
  readonly brows?: 'soft' | 'stern';
  /** いつもの前かがみ（ラジアン。年配の人など。Phase 6.5）。 */
  readonly stoop?: number;
}

export interface PersonRig {
  readonly root: THREE.Group;
  /** 全身（歩行・呼吸の上下動、左右の体重移動）。 */
  readonly body: THREE.Object3D;
  /** 腰から上（前かがみ・ひねり）。 */
  readonly torso: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly leftArm: THREE.Object3D;
  readonly rightArm: THREE.Object3D;
  readonly leftFore: THREE.Object3D;
  readonly rightFore: THREE.Object3D;
  readonly leftLeg: THREE.Object3D;
  readonly rightLeg: THREE.Object3D;
  /** 膝から下（Phase 6.5）。 */
  readonly leftShin: THREE.Object3D;
  readonly rightShin: THREE.Object3D;
  /** 顔（Phase 6.5）：目（縦に縮めてまばたき）、口（縦に伸ばして開く）、眉（上下）。 */
  readonly eyes: THREE.Object3D;
  readonly mouth: THREE.Object3D;
  readonly brows: THREE.Object3D;
  /** 全身のスキンメッシュ。 */
  readonly mesh: THREE.SkinnedMesh;
  /** 手に持つ物（必要なときだけ表示する）。 */
  readonly props: Readonly<Record<Exclude<HeldProp, null>, THREE.Object3D>>;
  /** いつもの前かがみ（applyPose で胴に足す）。 */
  readonly stoop: number;
}

let sharedMaterial: THREE.MeshStandardMaterial | null = null;
/** 全員で共有する頂点色のマテリアル。 */
export function personMaterial(): THREE.MeshStandardMaterial {
  sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return sharedMaterial;
}

let sharedShadow: { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
/** 足元の薄い接地の影（全員で共有する形と材質）。 */
function contactShadow(): THREE.Mesh {
  sharedShadow ??= {
    geo: new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2),
    mat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  const m = new THREE.Mesh(sharedShadow.geo, sharedShadow.mat);
  m.name = 'contact-shadow';
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}

interface Piece {
  readonly geo: THREE.BufferGeometry;
  readonly color: number;
  readonly at?: readonly [number, number, number];
  readonly rot?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
}

const cyl = (rTop: number, rBottom: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const sph = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** 回転体（半径と高さの組を下から順に）。 */
const lathe = (profile: ReadonlyArray<readonly [number, number]>, seg = 10) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** 2 点を結ぶ帯（襟・前の合わせ）。 */
function band(from: readonly [number, number, number], to: readonly [number, number, number], width: number, thick: number): Pick<Piece, 'geo' | 'at' | 'rot'> {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = a.add(b).multiplyScalar(0.5);
  return { geo: box(width, len, thick), at: [mid.x, mid.y, mid.z], rot: [e.x, e.y, e.z] };
}

/** 色を明るく・暗くする（布の縁・裾）。 */
function shade(hex: number, k: number): number {
  const c = new THREE.Color(hex);
  if (k >= 1) c.lerp(new THREE.Color(0xffffff), k - 1);
  else c.multiplyScalar(k);
  return c.getHex();
}

const DARK = 0x2a2420;
const STRAW = 0xc2a65b;
const SANDAL = 0x8a7350;
const SOCK = 0xe8e2d4;
const EYE = 0x1a1512;
const LIP = 0x7a3a30;

/** 骨と、その骨に付ける部品。 */
interface BoneParts {
  readonly bone: THREE.Bone;
  readonly pieces: Piece[];
}

export function createPersonRig(look: PersonAppearance): PersonRig {
  const b = look.build ?? 1;
  const long = look.coat === 'long';
  const sash = look.sash ?? DARK;
  const collar = look.collar ?? 0xe6dfcc;
  const cuff = shade(look.cloth, 0.78);
  const hem = shade(look.cloth, 0.7);
  const skinShade = shade(look.skin, 0.88);

  const bone = (name: string, parent: THREE.Object3D | null, x: number, y: number, z = 0): THREE.Bone => {
    const bn = new THREE.Bone();
    bn.name = name;
    bn.position.set(x, y, z);
    parent?.add(bn);
    return bn;
  };
  const body = bone('body', null, 0, 0);
  const torso = bone('torso', body, 0, 0.8);
  const head = bone('head', torso, 0, 0.72);
  // 顔の部品は頭の表面より少し前に出す（頭の球に埋もれないように）
  const eyes = bone('eyes', head, 0, 0.275, 0.207);
  const mouth = bone('mouth', head, 0, 0.165, 0.207);
  const brows = bone('brows', head, 0, 0.335, 0.2);
  const leftArm = bone('leftArm', torso, 0.32 * b, 0.62);
  const rightArm = bone('rightArm', torso, -0.32 * b, 0.62);
  const leftFore = bone('leftFore', leftArm, 0, -0.34);
  const rightFore = bone('rightFore', rightArm, 0, -0.34);
  const leftLeg = bone('leftLeg', body, 0.12 * b, 0.8);
  const rightLeg = bone('rightLeg', body, -0.12 * b, 0.8);
  const leftShin = bone('leftShin', leftLeg, 0, -0.38);
  const rightShin = bone('rightShin', rightLeg, 0, -0.38);

  const parts: BoneParts[] = [];
  const attach = (bn: THREE.Bone, pieces: Piece[]) => parts.push({ bone: bn, pieces });

  // ── 脚：腿・膝（腿の骨）、すね・足（すねの骨）──
  for (const [leg, shin] of [
    [leftLeg, leftShin],
    [rightLeg, rightShin],
  ] as const) {
    attach(leg, [
      { geo: cyl(0.108, 0.09, 0.38, 8), color: look.limb, at: [0, -0.19, 0] },
      { geo: sph(0.09, 8, 6), color: look.limb, at: [0, -0.38, 0.005] },
    ]);
    const shinPieces: Piece[] = [
      { geo: cyl(0.088, 0.068, 0.34, 8), color: look.limb, at: [0, -0.17, 0] },
      // 足袋と草履（つま先が前）
      { geo: box(0.1, 0.07, 0.2), color: SOCK, at: [0, -0.365, 0.035], scale: [1, 1, 1] },
      { geo: sph(0.055, 6, 4), color: SOCK, at: [0, -0.37, 0.12], scale: [0.95, 0.6, 1] },
      { geo: box(0.13, 0.03, 0.27), color: SANDAL, at: [0, -0.405, 0.05] },
    ];
    if (look.leggings !== undefined) shinPieces.push({ geo: cyl(0.092, 0.075, 0.27, 8), color: look.leggings, at: [0, -0.18, 0] });
    attach(shin, shinPieces);
  }

  // ── 胴：回転体で胸と腰の絞り、肩の丸み ──
  const torsoPieces: Piece[] = [
    {
      geo: lathe([
        [0.235, -0.02],
        [0.245, 0.1],
        [0.268, 0.28],
        [0.285, 0.44],
        [0.262, 0.56],
        [0.17, 0.645],
        [0.075, 0.68],
      ]),
      color: look.cloth,
      scale: [b, 1, 0.8],
    },
    // 肩の丸み
    { geo: sph(0.115, 8, 6), color: look.cloth, at: [0.27 * b, 0.6, 0], scale: [1, 0.8, 0.95] },
    { geo: sph(0.115, 8, 6), color: look.cloth, at: [-0.27 * b, 0.6, 0], scale: [1, 0.8, 0.95] },
    // 裾：短い上着は腰まで、長い上着は膝まで広がる（裾の縁は少し暗い）
    long
      ? {
          geo: lathe([
            [0.245, 0.02],
            [0.26, -0.15],
            [0.3, -0.42],
            [0.34, -0.6],
            [0.345, -0.62],
          ]),
          color: look.cloth,
          scale: [b, 1, 0.85],
        }
      : {
          geo: lathe([
            [0.24, 0.04],
            [0.27, -0.1],
            [0.3, -0.24],
            [0.305, -0.26],
          ]),
          color: look.cloth,
          scale: [b, 1, 0.85],
        },
    long
      ? { geo: cyl(0.347 * b, 0.347 * b, 0.05, 12), color: hem, at: [0, -0.595, 0], scale: [1, 1, 0.85] }
      : { geo: cyl(0.307 * b, 0.307 * b, 0.04, 12), color: hem, at: [0, -0.24, 0], scale: [1, 1, 0.85] },
    // 帯と、後ろの結び目
    { geo: cyl(0.258 * b, 0.252 * b, 0.13, 12), color: sash, at: [0, 0.12, 0], scale: [1, 1, 0.82] },
    { geo: box(0.2, 0.11, 0.08), color: shade(sash, 0.85), at: [0, 0.13, -0.235] },
    // 襟：右前（着る人の左の身頃が上）。首の後ろを回って胸の前で重なる
    { geo: new THREE.TorusGeometry(0.1, 0.028, 5, 12, Math.PI), color: collar, at: [0, 0.645, -0.02], rot: [Math.PI / 2 + 0.25, 0, Math.PI] },
    // 下の身頃（着る人の右）の襟は奥に、上の身頃（着る人の左）の襟は手前に重ねる
    { ...band([-0.1, 0.65, 0.11], [0.06, 0.35, 0.218], 0.065, 0.03), color: shade(collar, 0.9) },
    { ...band([0.1, 0.65, 0.135], [-0.11, 0.2, 0.24], 0.07, 0.035), color: collar },
    // 前の合わせ（上の身頃の縁が裾まで続く）
    { ...band([-0.11, 0.2, 0.237], [-0.13, long ? -0.58 : -0.23, long ? 0.29 : 0.26], 0.026, 0.02), color: shade(look.cloth, 0.82) },
  ];
  if (look.apron !== undefined) {
    torsoPieces.push(
      { geo: box(0.4 * b, long ? 0.78 : 0.46, 0.025), color: look.apron, at: [0, long ? -0.22 : -0.04, (long ? 0.3 : 0.25) * b], rot: [-0.05, 0, 0] },
      { geo: box(0.44 * b, 0.04, 0.03), color: shade(look.apron, 0.8), at: [0, long ? 0.17 : 0.17, 0.215 * b] },
    );
  }
  if (look.tasuki !== undefined) {
    for (const sign of [1, -1]) {
      torsoPieces.push({ geo: box(0.035, 0.75, 0.03), color: look.tasuki, at: [0, 0.4, 0.235 * b], rot: [0.1, 0, sign * 0.62] });
      torsoPieces.push({ geo: box(0.035, 0.75, 0.03), color: look.tasuki, at: [0, 0.4, -0.235 * b], rot: [-0.1, 0, sign * 0.62] });
    }
  }
  if (look.pack === 'basket') {
    torsoPieces.push(
      { geo: cyl(0.22, 0.16, 0.55, 10), color: 0xa8915e, at: [0, 0.42, -0.4 * b] },
      { geo: new THREE.TorusGeometry(0.22, 0.025, 4, 12), color: 0x6a5844, at: [0, 0.7, -0.4 * b], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.03, 0.5, 0.03), color: 0x6a5844, at: [0.12, 0.48, 0.02], rot: [0.5, 0, 0] },
      { geo: box(0.03, 0.5, 0.03), color: 0x6a5844, at: [-0.12, 0.48, 0.02], rot: [0.5, 0, 0] },
    );
  } else if (look.pack === 'bag') {
    torsoPieces.push(
      { geo: box(0.05, 0.85, 0.03), color: 0x6a5240, at: [0, 0.38, 0.245 * b], rot: [0.08, 0, 0.75] },
      { geo: box(0.24, 0.22, 0.09), color: 0x8a6a48, at: [-0.27 * b, -0.04, 0.1] },
    );
  }
  attach(torso, torsoPieces);

  // ── 頭：首・頭・鼻・耳・髪・かぶり物 ──
  const headPieces: Piece[] = [
    { geo: cyl(0.068, 0.078, 0.14, 8), color: skinShade, at: [0, 0.03, 0] },
    { geo: sph(0.2, 12, 9), color: look.skin, at: [0, 0.255, 0.01], scale: [1, 1.08, 1.02] },
    // あご・頬（下半分を少しふっくら）
    { geo: sph(0.165, 10, 6), color: look.skin, at: [0, 0.19, 0.05], scale: [1.05, 0.8, 0.95] },
    // 鼻・耳
    { geo: sph(0.034, 6, 4), color: skinShade, at: [0, 0.225, 0.205], scale: [0.75, 0.9, 0.8] },
    { geo: sph(0.045, 6, 4), color: skinShade, at: [0.198, 0.245, 0], scale: [0.45, 1, 0.8] },
    { geo: sph(0.045, 6, 4), color: skinShade, at: [-0.198, 0.245, 0], scale: [0.45, 1, 0.8] },
  ];
  // 髪（頭頂と後ろ、前髪の生え際）。手ぬぐいをかぶる人は覆われて見えない
  if (look.headwear !== 'kerchief') {
    headPieces.push(
      { geo: new THREE.SphereGeometry(0.214, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), color: look.hair, at: [0, 0.27, -0.015], rot: [-0.55, 0, 0] },
      { geo: box(0.3, 0.05, 0.08), color: look.hair, at: [0, 0.385, 0.13], rot: [0.5, 0, 0] },
      // もみあげ
      { geo: box(0.03, 0.09, 0.06), color: look.hair, at: [0.19, 0.27, 0.06] },
      { geo: box(0.03, 0.09, 0.06), color: look.hair, at: [-0.19, 0.27, 0.06] },
    );
  }
  if (look.hairStyle === 'bun') headPieces.push({ geo: sph(0.09, 8, 6), color: look.hair, at: [0, 0.37, -0.18] });
  if (look.beard) {
    headPieces.push(
      { geo: sph(0.12, 10, 6), color: look.hair, at: [0, 0.11, 0.11], scale: [1.15, 0.75, 0.8] },
      { geo: box(0.13, 0.025, 0.03), color: look.hair, at: [0, 0.185, 0.2] },
    );
  }
  const hw = look.headwearColor;
  switch (look.headwear) {
    case 'straw':
      headPieces.push(
        { geo: new THREE.ConeGeometry(0.44, 0.22, 16), color: hw ?? STRAW, at: [0, 0.52, 0] },
        { geo: new THREE.ConeGeometry(0.1, 0.06, 10), color: shade(hw ?? STRAW, 0.8), at: [0, 0.64, 0] },
        { geo: box(0.02, 0.24, 0.02), color: 0x6a5844, at: [0.15, 0.24, 0.12], rot: [0, 0, 0.2] },
      );
      break;
    case 'wideStraw':
      headPieces.push(
        { geo: cyl(0.44, 0.44, 0.025, 18), color: hw ?? STRAW, at: [0, 0.41, 0] },
        { geo: cyl(0.17, 0.2, 0.17, 14), color: hw ?? STRAW, at: [0, 0.5, 0] },
        { geo: cyl(0.205, 0.205, 0.04, 14), color: 0x6a4a30, at: [0, 0.44, 0] },
      );
      break;
    case 'kerchief':
      headPieces.push(
        {
          geo: new THREE.SphereGeometry(0.228, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
          color: hw ?? 0xe8e2d4,
          at: [0, 0.265, -0.015],
          rot: [-0.36, 0, 0],
        },
        // 額の折り返しと、後ろの結び目
        { geo: box(0.36, 0.04, 0.05), color: shade(hw ?? 0xe8e2d4, 0.9), at: [0, 0.37, 0.15], rot: [0.35, 0, 0] },
        { geo: sph(0.06, 6, 5), color: hw ?? 0xe8e2d4, at: [0, 0.25, -0.23] },
        { geo: box(0.05, 0.12, 0.02), color: hw ?? 0xe8e2d4, at: [0.03, 0.17, -0.23], rot: [0.2, 0, 0.3] },
      );
      break;
    case 'band':
      headPieces.push(
        { geo: new THREE.TorusGeometry(0.205, 0.028, 5, 18), color: hw ?? 0xf0ece0, at: [0, 0.34, 0.005], rot: [Math.PI / 2 + 0.12, 0, 0] },
        { geo: box(0.05, 0.12, 0.03), color: hw ?? 0xf0ece0, at: [0.04, 0.3, -0.21], rot: [0, 0, 0.5] },
      );
      break;
    case 'none':
      break;
  }
  attach(head, headPieces);

  // 顔の部品（目・口・眉は、それぞれの骨で動かす）
  attach(eyes, [
    { geo: sph(0.026, 6, 4), color: EYE, at: [0.068, 0, 0], scale: [1, 1.15, 0.6] },
    { geo: sph(0.026, 6, 4), color: EYE, at: [-0.068, 0, 0], scale: [1, 1.15, 0.6] },
  ]);
  attach(mouth, [{ geo: sph(0.03, 6, 4), color: LIP, scale: [1.5, 0.32, 0.5] }]);
  const browTilt = look.brows === 'stern' ? 0.22 : 0.06;
  const browColor = look.headwear === 'kerchief' ? shade(look.hair, 1) : look.hair;
  attach(brows, [
    { geo: box(0.075, 0.017, 0.02), color: browColor, at: [0.07, 0, 0], rot: [0, 0, -browTilt] },
    { geo: box(0.075, 0.017, 0.02), color: browColor, at: [-0.07, 0, 0], rot: [0, 0, browTilt] },
  ]);

  // ── 腕：袖（肩から肘へ少し広がる）、肘。前腕：袖の続きと袖口、手首、手（親指）──
  for (const [arm, fore, side] of [
    [leftArm, leftFore, 1],
    [rightArm, rightFore, -1],
  ] as const) {
    attach(arm, [
      { geo: cyl(0.098, 0.112, 0.34, 8), color: look.cloth, at: [0, -0.17, 0] },
      { geo: sph(0.095, 8, 6), color: look.cloth, at: [0, -0.34, 0] },
    ]);
    const forePieces: Piece[] = [
      { geo: cyl(0.108, 0.1, 0.2, 8), color: look.cloth, at: [0, -0.09, 0] },
      { geo: cyl(0.103, 0.103, 0.035, 8), color: cuff, at: [0, -0.195, 0] },
      { geo: cyl(0.042, 0.046, 0.08, 8), color: skinShade, at: [0, -0.23, 0] },
      { geo: sph(0.058, 8, 6), color: look.skin, at: [0, -0.3, 0.008], scale: [0.85, 1.12, 0.55] },
      { geo: sph(0.024, 5, 4), color: look.skin, at: [side * -0.04, -0.28, 0.035], scale: [1, 1.5, 1] },
    ];
    // 長い上着の人は、袖の下が袋のように垂れる（袂）
    if (long) forePieces.push({ geo: box(0.05, 0.2, 0.22), color: look.cloth, at: [0, -0.1, -0.04], scale: [1, 1, 1] });
    attach(fore, forePieces);
  }

  // ── 部品を骨ごとの頂点色付きジオメトリにして、一つのスキンメッシュにまとめる ──
  const bones: THREE.Bone[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Bone) bones.push(o);
  });
  body.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  for (const { bone: bn, pieces } of parts) {
    const index = bones.indexOf(bn);
    for (const p of pieces) {
      const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
      g.deleteAttribute('uv');
      q.setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
      m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
      g.applyMatrix4(m.premultiply(bn.matrixWorld));
      const n = g.attributes.position!.count;
      c.set(p.color);
      const colors = new Float32Array(n * 3);
      const skinIndex = new Uint16Array(n * 4);
      const skinWeight = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        skinIndex[i * 4] = index;
        skinWeight[i * 4] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
      geos.push(g);
    }
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('人物の部品をまとめられません');
  for (const g of geos) g.dispose();
  const mesh = new THREE.SkinnedMesh(merged, personMaterial());
  mesh.name = 'person';
  mesh.castShadow = true;
  mesh.add(body);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // 姿勢で手足が伸びても切れないよう、少し大きめの境界球にする
  merged.computeBoundingSphere();
  if (merged.boundingSphere) merged.boundingSphere.radius += 0.6;

  const root = new THREE.Group();
  root.add(mesh, contactShadow());
  root.scale.setScalar(look.height ?? 1);
  const props = createHeldProps({ body, torso, leftFore, rightFore });
  return {
    root,
    body,
    torso,
    head,
    leftArm,
    rightArm,
    leftFore,
    rightFore,
    leftLeg,
    rightLeg,
    leftShin,
    rightShin,
    eyes,
    mouth,
    brows,
    mesh,
    props,
    stoop: look.stoop ?? 0,
  };
}

/** 手に持つ物。必要なときだけ表示する（setHeldProp）。 */
function createHeldProps(at: { body: THREE.Object3D; torso: THREE.Object3D; leftFore: THREE.Object3D; rightFore: THREE.Object3D }) {
  const KAYA = 0xd4b46a;
  const TIE = 0x7a6448;
  const part = (pieces: Piece[]) => {
    const geos = pieces.map((p) => {
      const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
      g.deleteAttribute('uv');
      const mtx = new THREE.Matrix4().compose(
        new THREE.Vector3(...(p.at ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
        new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
      );
      g.applyMatrix4(mtx);
      const col = new THREE.Color(p.color);
      const n = g.attributes.position!.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, personMaterial());
    mesh.castShadow = true;
    return mesh;
  };
  const cane = part([{ geo: cyl(0.025, 0.03, 0.98, 6), color: 0x5a4030, at: [0, 0.49, 0] }]);
  cane.position.set(-0.43, 0, 0.24);
  cane.rotation.x = 0.04;
  at.body.add(cane);

  const book = part([
    { geo: box(0.2, 0.26, 0.035), color: 0x3a3a48 },
    { geo: box(0.19, 0.25, 0.02), color: 0xe8e0c8, at: [0, 0, 0.02] },
  ]);
  book.position.set(-0.04, -0.3, 0.06);
  book.rotation.set(-0.3, 0, 0.3);
  at.leftFore.add(book);

  // 肩に担ぐ茅の束（胴に付ける：腕の振りとは別に、肩の上に載る）
  const bundle = part([
    { geo: cyl(0.15, 0.2, 1.5, 8), color: KAYA },
    { geo: cyl(0.21, 0.21, 0.06, 8), color: TIE, at: [0, -0.35, 0] },
    { geo: cyl(0.17, 0.17, 0.06, 8), color: TIE, at: [0, 0.35, 0] },
  ]);
  bundle.position.set(-0.24, 0.84, -0.05);
  bundle.rotation.set(Math.PI / 2 - 0.35, 0, 0.15);
  at.torso.add(bundle);

  // 両腕で抱える茅の束
  const kayaArms = part([
    { geo: cyl(0.17, 0.2, 1.2, 8), color: KAYA },
    { geo: cyl(0.21, 0.21, 0.06, 8), color: TIE, at: [0, -0.3, 0] },
    { geo: cyl(0.18, 0.18, 0.06, 8), color: TIE, at: [0, 0.3, 0] },
  ]);
  kayaArms.position.set(0, 0.32, 0.36);
  kayaArms.rotation.set(0, 0, Math.PI / 2);
  at.torso.add(kayaArms);

  // 屋根の茅を叩いて整える道具（柄と平たい板）
  const beater = part([
    { geo: cyl(0.025, 0.025, 0.5, 6), color: 0x8c6a45, at: [0, -0.2, 0] },
    { geo: box(0.2, 0.32, 0.05), color: 0x8c6a45, at: [0, -0.55, 0.05] },
  ]);
  beater.position.set(0, -0.3, 0.02);
  beater.rotation.x = -1.0;
  at.rightFore.add(beater);

  const props = { cane, book, bundle, kayaArms, beater };
  for (const p of Object.values(props)) p.visible = false;
  return props;
}

/** 手に持つ物を切り替える（一つだけ表示する）。 */
export function setHeldProp(rig: PersonRig, prop: HeldProp): void {
  for (const [key, obj] of Object.entries(rig.props)) obj.visible = key === prop;
}

/**
 * 膝の曲げ（ラジアン、正で曲がる）。姿勢の型には膝の角度を持たせず、脚の振りから決める（Phase 6.5）。
 * 後ろへ振った脚は大きく曲げて地面を蹴り、前へ出した脚は少しだけ曲げる。前かがみの作業では両膝を少し曲げる。
 */
export function kneeBend(legX: number, torsoX: number): number {
  return 0.06 + Math.max(0, legX) * 1.35 + Math.max(0, -legX) * 0.25 + Math.max(0, torsoX - 0.25) * 0.35;
}

/** 姿勢を人物モデルに当てはめる。 */
export function applyPose(rig: PersonRig, p: JointPose): void {
  rig.body.position.set(p.bodyX, p.bodyY, 0);
  rig.torso.rotation.set(p.torsoX + rig.stoop, p.torsoY, p.torsoZ);
  rig.head.rotation.set(p.headX - rig.stoop * 0.6, p.headY, p.headZ);
  rig.leftArm.rotation.set(p.lArmX, 0, p.lArmZ);
  rig.rightArm.rotation.set(p.rArmX, 0, p.rArmZ);
  rig.leftFore.rotation.set(p.lForeX, 0, p.lForeZ);
  rig.rightFore.rotation.set(p.rForeX, 0, p.rForeZ);
  rig.leftLeg.rotation.x = p.lLegX;
  rig.rightLeg.rotation.x = p.rLegX;
  rig.leftShin.rotation.x = kneeBend(p.lLegX, p.torsoX);
  rig.rightShin.rotation.x = kneeBend(p.rLegX, p.torsoX);
}

/** 表情（0〜1）：blink＝目を閉じる、mouth＝口を開く、brow＝眉を上げる。 */
export interface FaceState {
  readonly blink: number;
  readonly mouth: number;
  readonly brow: number;
}

export function applyFace(rig: PersonRig, f: FaceState): void {
  rig.eyes.scale.set(1, Math.max(0.08, 1 - f.blink), 1);
  rig.mouth.scale.set(1 - f.mouth * 0.25, 1 + f.mouth * 2.6, 1);
  rig.brows.position.y = 0.335 + f.brow * 0.018;
}
