import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeldProp, JointPose } from './poses';

/**
 * 人物モデル（プレイヤー・住民・村の人たちで共通。docs/PHASE5_ART.md §3）。
 *
 * - デフォルメした人の比率。服の形（上着の丈・前掛け・たすき・背負い籠など）とかぶり物で、
 *   色だけでなくシルエットでも見分けられるようにする。
 * - 部位（胴・頭・上腕・前腕・脚）ごとに、部品を頂点色付きの一つのジオメトリにまとめ、
 *   全員で一つのマテリアルを使う（一人あたりの描画呼び出しを 8 回に抑える）。
 * - 服装は時代を特定しない素朴な野良着の形（村の時代設定は未確定）。
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
}

export interface PersonRig {
  readonly root: THREE.Group;
  /** 全身（歩行・呼吸の上下動、左右の体重移動）。 */
  readonly body: THREE.Group;
  /** 腰から上（前かがみ・ひねり）。 */
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightArm: THREE.Group;
  readonly leftFore: THREE.Group;
  readonly rightFore: THREE.Group;
  readonly leftLeg: THREE.Group;
  readonly rightLeg: THREE.Group;
  /** 手に持つ物（必要なときだけ表示する）。 */
  readonly props: Readonly<Record<Exclude<HeldProp, null>, THREE.Object3D>>;
}

let sharedMaterial: THREE.MeshStandardMaterial | null = null;
/** 全員で共有する頂点色のマテリアル。 */
export function personMaterial(): THREE.MeshStandardMaterial {
  sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return sharedMaterial;
}

interface Piece {
  readonly geo: THREE.BufferGeometry;
  readonly color: number;
  readonly at?: readonly [number, number, number];
  readonly rot?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
}

/** 部品を変形し、頂点色を付けて一つのジオメトリにまとめる。 */
function bake(pieces: readonly Piece[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const geos = pieces.map((p) => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
    g.deleteAttribute('uv');
    q.setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    c.set(p.color);
    const n = g.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('人物の部品をまとめられません');
  return merged;
}

const cyl = (rTop: number, rBottom: number, h: number, seg = 10) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const sph = (r: number, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function part(pieces: readonly Piece[]): THREE.Mesh {
  const mesh = new THREE.Mesh(bake(pieces), personMaterial());
  mesh.castShadow = true;
  return mesh;
}

const DARK = 0x2a2420;
const STRAW = 0xc2a65b;
const SANDAL = 0x8a7350;

export function createPersonRig(look: PersonAppearance): PersonRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  const leftFore = new THREE.Group();
  const rightFore = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  const b = look.build ?? 1;
  const long = look.coat === 'long';
  const sash = look.sash ?? DARK;
  const collar = look.collar ?? 0xe6dfcc;

  // ── 脚（腰の高さが回転の中心）──
  for (const [leg, x] of [
    [leftLeg, 0.12],
    [rightLeg, -0.12],
  ] as const) {
    leg.position.set(x * b, 0.8, 0);
    const pieces: Piece[] = [
      { geo: cyl(0.1, 0.085, 0.7), color: look.limb, at: [0, -0.35, 0] },
      { geo: box(0.13, 0.08, 0.25), color: SANDAL, at: [0, -0.76, 0.04] },
    ];
    if (look.leggings !== undefined) pieces.push({ geo: cyl(0.095, 0.088, 0.3), color: look.leggings, at: [0, -0.52, 0] });
    leg.add(part(pieces));
    body.add(leg);
  }

  // ── 胴 ──
  torso.position.y = 0.8;
  const torsoPieces: Piece[] = [
    { geo: cyl(0.27 * b, 0.25 * b, 0.62, 12), color: look.cloth, at: [0, 0.38, 0] },
    { geo: sph(0.28, 12, 8), color: look.cloth, at: [0, 0.66, 0], scale: [b, 0.45, 0.8] },
    // 腰回り（上着の裾）
    long
      ? { geo: cyl(0.27 * b, 0.33 * b, 0.62, 12), color: look.cloth, at: [0, -0.22, 0] }
      : { geo: cyl(0.27 * b, 0.3 * b, 0.22, 12), color: look.cloth, at: [0, 0.0, 0] },
    // 帯
    { geo: cyl(0.272 * b, 0.272 * b, 0.1, 12), color: sash, at: [0, 0.12, 0] },
    // 襟（首元から胸の前で合わさる V 字）
    { geo: box(0.05, 0.34, 0.03), color: collar, at: [0.065, 0.53, 0.245], rot: [0.12, 0, -0.4] },
    { geo: box(0.05, 0.34, 0.03), color: collar, at: [-0.065, 0.53, 0.245], rot: [0.12, 0, 0.4] },
  ];
  if (look.apron !== undefined) {
    torsoPieces.push({ geo: box(0.4 * b, long ? 0.84 : 0.5, 0.025), color: look.apron, at: [0, long ? -0.24 : -0.05, (long ? 0.31 : 0.28) * b] });
  }
  if (look.tasuki !== undefined) {
    for (const sign of [1, -1]) {
      torsoPieces.push({ geo: box(0.035, 0.75, 0.03), color: look.tasuki, at: [0, 0.4, 0.27 * b], rot: [0.1, 0, sign * 0.62] });
      torsoPieces.push({ geo: box(0.035, 0.75, 0.03), color: look.tasuki, at: [0, 0.4, -0.27 * b], rot: [-0.1, 0, sign * 0.62] });
    }
  }
  if (look.pack === 'basket') {
    torsoPieces.push(
      { geo: cyl(0.22, 0.16, 0.55, 10), color: 0xa8915e, at: [0, 0.42, -0.42 * b] },
      { geo: new THREE.TorusGeometry(0.22, 0.025, 4, 12), color: 0x6a5844, at: [0, 0.7, -0.42 * b], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.03, 0.5, 0.03), color: 0x6a5844, at: [0.12, 0.48, 0.0], rot: [0.5, 0, 0] },
      { geo: box(0.03, 0.5, 0.03), color: 0x6a5844, at: [-0.12, 0.48, 0.0], rot: [0.5, 0, 0] },
    );
  } else if (look.pack === 'bag') {
    torsoPieces.push(
      { geo: box(0.05, 0.85, 0.03), color: 0x6a5240, at: [0, 0.38, 0.265 * b], rot: [0.08, 0, 0.75] },
      { geo: box(0.24, 0.22, 0.09), color: 0x8a6a48, at: [-0.27 * b, -0.02, 0.12] },
    );
  }
  torso.add(part(torsoPieces));
  body.add(torso);

  // ── 頭（首が回転の中心）──
  head.position.y = 0.72;
  const headPieces: Piece[] = [
    { geo: cyl(0.075, 0.08, 0.12, 8), color: look.skin, at: [0, 0.04, 0] },
    { geo: sph(0.21, 16, 12), color: look.skin, at: [0, 0.25, 0.01], scale: [1, 1.06, 1] },
    { geo: sph(0.035, 6, 5), color: look.skin, at: [0.2, 0.24, 0] },
    { geo: sph(0.035, 6, 5), color: look.skin, at: [-0.2, 0.24, 0] },
    // 目（向いている方向が分かるように）
    { geo: sph(0.024, 6, 5), color: 0x1a1512, at: [0.07, 0.27, 0.195] },
    { geo: sph(0.024, 6, 5), color: 0x1a1512, at: [-0.07, 0.27, 0.195] },
  ];
  // 髪（頭頂と後ろ。顔にかからないよう後ろへ傾ける）。手ぬぐいをかぶる人は覆われて見えない
  if (look.headwear !== 'kerchief') {
    headPieces.push({
      geo: new THREE.SphereGeometry(0.224, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      color: look.hair,
      at: [0, 0.28, -0.02],
      rot: [-0.62, 0, 0],
    });
  }
  if (look.hairStyle === 'bun') headPieces.push({ geo: sph(0.09, 8, 6), color: look.hair, at: [0, 0.38, -0.17] });
  if (look.beard) headPieces.push({ geo: sph(0.12, 10, 6, ), color: look.hair, at: [0, 0.13, 0.12], scale: [1.1, 0.7, 0.8] });
  const hw = look.headwearColor;
  switch (look.headwear) {
    case 'straw':
      // 笠（円錐）
      headPieces.push(
        { geo: new THREE.ConeGeometry(0.44, 0.22, 16), color: hw ?? STRAW, at: [0, 0.52, 0] },
        { geo: box(0.02, 0.24, 0.02), color: 0x6a5844, at: [0.15, 0.24, 0.12], rot: [0, 0, 0.2] },
      );
      break;
    case 'wideStraw':
      // 幅広のつばの麦わら帽子
      headPieces.push(
        { geo: cyl(0.44, 0.44, 0.025, 18), color: hw ?? STRAW, at: [0, 0.41, 0] },
        { geo: cyl(0.17, 0.2, 0.17, 14), color: hw ?? STRAW, at: [0, 0.5, 0] },
        { geo: cyl(0.205, 0.205, 0.04, 14), color: 0x6a4a30, at: [0, 0.44, 0] },
      );
      break;
    case 'kerchief':
      // 手ぬぐいをかぶる（頭頂と後ろを覆い、後ろで結ぶ）
      headPieces.push(
        {
          geo: new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
          color: hw ?? 0xe8e2d4,
          at: [0, 0.27, -0.02],
          rot: [-0.38, 0, 0],
        },
        { geo: sph(0.06, 6, 5), color: hw ?? 0xe8e2d4, at: [0, 0.26, -0.24] },
      );
      break;
    case 'band':
      // 鉢巻
      headPieces.push(
        { geo: new THREE.TorusGeometry(0.213, 0.028, 5, 18), color: hw ?? 0xf0ece0, at: [0, 0.34, 0], rot: [Math.PI / 2 + 0.12, 0, 0] },
        { geo: box(0.05, 0.12, 0.03), color: hw ?? 0xf0ece0, at: [0.04, 0.3, -0.22], rot: [0, 0, 0.5] },
      );
      break;
    case 'none':
      break;
  }
  head.add(part(headPieces));
  torso.add(head);

  // ── 腕（肩が回転の中心、肘で前腕が曲がる）──
  for (const [arm, fore, x] of [
    [leftArm, leftFore, 0.33],
    [rightArm, rightFore, -0.33],
  ] as const) {
    arm.position.set(x * b, 0.64, 0);
    arm.add(part([{ geo: cyl(0.095, 0.085, 0.36, 8), color: look.cloth, at: [0, -0.17, 0] }]));
    fore.position.y = -0.34;
    fore.add(
      part([
        { geo: cyl(0.08, 0.065, 0.24, 8), color: look.cloth, at: [0, -0.1, 0] },
        { geo: cyl(0.05, 0.045, 0.08, 8), color: look.skin, at: [0, -0.24, 0] },
        { geo: sph(0.065, 8, 6), color: look.skin, at: [0, -0.31, 0.01], scale: [0.85, 1, 0.75] },
      ]),
    );
    arm.add(fore);
    torso.add(arm);
  }

  root.add(body);
  root.scale.setScalar(look.height ?? 1);
  const props = createHeldProps({ body, torso, leftFore, rightFore });
  return { root, body, torso, head, leftArm, rightArm, leftFore, rightFore, leftLeg, rightLeg, props };
}

/** 手に持つ物。必要なときだけ表示する（setHeldProp）。 */
function createHeldProps(at: { body: THREE.Group; torso: THREE.Group; leftFore: THREE.Group; rightFore: THREE.Group }) {
  const KAYA = 0xd4b46a;
  const TIE = 0x7a6448;
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

/** 姿勢を人物モデルに当てはめる。 */
export function applyPose(rig: PersonRig, p: JointPose): void {
  rig.body.position.set(p.bodyX, p.bodyY, 0);
  rig.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
  rig.head.rotation.set(p.headX, p.headY, p.headZ);
  rig.leftArm.rotation.set(p.lArmX, 0, p.lArmZ);
  rig.rightArm.rotation.set(p.rArmX, 0, p.rArmZ);
  rig.leftFore.rotation.set(p.lForeX, 0, p.lForeZ);
  rig.rightFore.rotation.set(p.rForeX, 0, p.rForeZ);
  rig.leftLeg.rotation.x = p.lLegX;
  rig.rightLeg.rotation.x = p.rLegX;
}
