import type { Collider } from '../core/collision';
import { BUILDINGS, BUILDING_FOOTPRINT } from './layout';

/**
 * 宗平の作業場の中（Phase 6.5、docs/PHASE6_5_PLAN.md §2.3）。描画・当たり判定・床の高さ・テストがこのデータを共有する。
 *
 * 正面（南、+Z）の開口から歩いて入り、同じ所から出る。中には材木・作業台・作りかけの梯子など（ゲーム用の創作の小屋で、
 * 特定の建物の再現ではない）。座標は作業場の中心からの相対（作業場は回転していない）。
 */
const DEF = BUILDINGS.find((b) => b.kind === 'workshop')!;
const FP = BUILDING_FOOTPRINT.workshop;

export const WORKSHOP = {
  center: { x: DEF.position.x, z: DEF.position.z },
  /** 土台（石）の範囲。この上は平らな床。 */
  base: { halfWidth: FP.halfWidth, halfDepth: FP.halfDepth },
  /** 床の高さ（地面からの高さ）。土台と板の床。 */
  floorLift: 0.25,
  /** 壁の内側（ここから内が「作業場の中」。カメラを近めにする）。 */
  inner: { halfWidth: 3.78, minZ: -2.78, maxZ: 2.8 },
  /** 正面の開口（x の範囲）。 */
  door: { halfWidth: 2.4 },
  /** 壁の厚みの半分。 */
  wallHalf: 0.12,
  /** 中の物（当たり判定。中心からの相対）。 */
  props: [
    // 奥の壁際の材木の束
    { id: 'lumber', x: -0.6, z: -2.33, halfWidth: 1.78, halfDepth: 0.36 },
    // 作業台（鉋・のみ・墨壺を置いた台）
    { id: 'bench', x: 2.0, z: -0.6, halfWidth: 0.95, halfDepth: 0.4 },
    // 奥の壁の道具掛け
    { id: 'toolWall', x: 2.65, z: -2.62, halfWidth: 0.75, halfDepth: 0.2 },
    // 丸太を載せた木挽き台
    { id: 'sawhorse', x: -2.3, z: -0.35, halfWidth: 0.85, halfDepth: 0.36 },
    // 右の壁に立てかけた、作りかけの梯子
    { id: 'ladder', x: 3.45, z: 1.0, halfWidth: 0.3, halfDepth: 1.05 },
    // 左手前の縄と茅の束
    { id: 'bundles', x: -3.2, z: 1.75, halfWidth: 0.5, halfDepth: 0.55 },
  ],
} as const;

/** (x, z) が作業場の土台の上か（床の高さを使う）。 */
export function isOnWorkshopFloor(x: number, z: number): boolean {
  const c = WORKSHOP.center;
  return Math.abs(x - c.x) < WORKSHOP.base.halfWidth && Math.abs(z - c.z) < WORKSHOP.base.halfDepth;
}

/** (x, z) が作業場の壁の内側か（カメラを近めにする範囲）。 */
export function isInsideWorkshop(x: number, z: number): boolean {
  const c = WORKSHOP.center;
  const i = WORKSHOP.inner;
  return Math.abs(x - c.x) < i.halfWidth && z - c.z > i.minZ && z - c.z < i.maxZ;
}

/**
 * 作業場の当たり判定：奥と両脇の壁、正面の開口の両脇の壁（柱を含む）、中の物、正面に立てかけた材木。
 * 建物の外形の箱の代わりに使う（正面の開口から中へ入れる）。
 */
export function workshopColliders(): Collider[] {
  const c = WORKSHOP.center;
  const box = (x: number, z: number, halfWidth: number, halfDepth: number): Collider => ({
    kind: 'box',
    x: c.x + x,
    z: c.z + z,
    halfWidth,
    halfDepth,
    rotation: 0,
  });
  const t = WORKSHOP.wallHalf;
  const outerX = 3.9;
  const backZ = -2.9;
  const frontZ = 2.9;
  const door = WORKSHOP.door.halfWidth;
  // 開口の両脇の柱（太さ 0.26）の内側の面から、角の柱の外側まで
  const postHalf = 0.13;
  const frontPartHalf = (outerX + postHalf - (door - postHalf)) / 2;
  const frontPartX = door - postHalf + frontPartHalf;
  return [
    box(0, backZ, outerX + t, t + 0.02),
    box(outerX, 0, t, 3.0),
    box(-outerX, 0, t, 3.0),
    // 正面の壁（開口の両脇）。柱の太さの分だけ内側まで
    box(frontPartX, frontZ, frontPartHalf, 0.16),
    box(-frontPartX, frontZ, frontPartHalf, 0.16),
    ...WORKSHOP.props.map((p) => box(p.x, p.z, p.halfWidth, p.halfDepth)),
    // 正面の左に立てかけた材木
    box(-3.25, 3.2, 0.55, 0.15),
  ];
}
