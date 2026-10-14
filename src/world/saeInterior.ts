import type { Collider } from '../core/collision';
import type { Vec2 } from '../core/math';

/**
 * サエ家の室内の配置（Phase 5.5、docs/PHASE5_5_PLAN.md §2）。描画・当たり判定・テストがこのデータを共有する。
 *
 * サエ家は架空の家（実在の家屋の復元ではない）。間取りは資料にある一般的な構成に沿わせた：
 * 入口の土間 → 囲炉裏のある板の間（おえ）→ 奥の部屋（閉じた襖の向こう、入れない）。居間の上は格子の天井。
 *
 * 座標はワールド座標（サエ家は原点にあり、棟が東西）。北 = -Z、南 = +Z。
 * 外壁の内側の面は x = ±8.1, z = ±5.7（外形の壁は gassho.ts の hollow で作る）。
 */
export const SAE_INTERIOR = {
  /** 室内（外壁の内側）の範囲。 */
  bounds: { minX: -8.1, maxX: 8.1, minZ: -5.7, maxZ: 5.7 },
  /** 床の高さ（家の足元からの高さ。gassho.ts の SILL_Y × 縮尺 1.2）。 */
  floorLift: 0.72,
  /** 格子の天井の高さ（床から）。 */
  ceiling: 3.3,
  /** 土間と板の間の境（これより南が土間）。 */
  domaZ: 2.4,
  /** 奥の部屋との間仕切り（これより東は入れない）。 */
  partitionX: 3.0,
  /** 板の間の西の端（これより西は物置き・作業の場）。 */
  oeWestX: -3.6,
  /** 囲炉裏（中心と半分の大きさ）。 */
  irori: { x: -0.3, z: -1.4, half: 0.75 },
  /** 結帳の棚（北の壁際）。 */
  ledgerShelf: { x: 1.4, z: -5.3, halfWidth: 0.55, halfDepth: 0.35 },
  /** 屋根裏へ上がる急な階段（飾り。上がれない）。 */
  stairs: { x: -7.35, z: -4.5, halfWidth: 0.6, halfDepth: 1.0 },
  /** 柱（大黒柱など）。 */
  posts: [
    { x: -3.6, z: 2.4 },
    { x: -3.6, z: -1.6 },
    { x: 3.0, z: 2.4 },
  ] as readonly Vec2[],
  /** 物置き（薪・茅の束・水がめ・かご）。 */
  storage: [
    { kind: 'woodpile', x: -7.6, z: -0.8, halfWidth: 0.5, halfDepth: 1.3 },
    { kind: 'kaya', x: -7.4, z: 3.9, halfWidth: 0.6, halfDepth: 1.1 },
    { kind: 'jar', x: -5.2, z: 4.9, radius: 0.45 },
    { kind: 'basket', x: -4.2, z: 5.05, radius: 0.35 },
  ] as const,
  /** 入口（南の壁の中央）。 */
  door: { x: 0, z: 5.85, halfWidth: 1.05 },
  /** 家に入ったときの位置（入口の内側、北を向く）と、出たときの位置（入口の外、南を向く）。 */
  entry: { x: 0, z: 3.4, heading: Math.PI },
  exit: { x: 0, z: 7.55, heading: 0 },
} as const;

const WALL_HALF = 0.15;

/** (x, z) がサエ家の室内（外壁の内側）か。 */
export function isInsideSaeHouse(x: number, z: number): boolean {
  const b = SAE_INTERIOR.bounds;
  return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
}

/** 室内の当たり判定：外壁・奥の部屋の間仕切り・囲炉裏・棚・階段・柱・物置きの物。 */
export function saeInteriorColliders(): Collider[] {
  const b = SAE_INTERIOR.bounds;
  const box = (x: number, z: number, halfWidth: number, halfDepth: number): Collider => ({
    kind: 'box',
    x,
    z,
    halfWidth,
    halfDepth,
    rotation: 0,
  });
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = (b.maxX - b.minX) / 2;
  const d = (b.maxZ - b.minZ) / 2;
  const colliders: Collider[] = [
    // 外壁（入口の戸も閉じている：出入りは E で行う）
    box(cx, b.minZ - WALL_HALF, w + 0.3, WALL_HALF),
    box(cx, b.maxZ + WALL_HALF, w + 0.3, WALL_HALF),
    box(b.minX - WALL_HALF, cz, WALL_HALF, d + 0.3),
    box(b.maxX + WALL_HALF, cz, WALL_HALF, d + 0.3),
    // 奥の部屋（東）との間仕切り：東側はまるごと入れない
    box((SAE_INTERIOR.partitionX + b.maxX) / 2, cz, (b.maxX - SAE_INTERIOR.partitionX) / 2, d),
  ];
  const i = SAE_INTERIOR.irori;
  colliders.push(box(i.x, i.z, i.half, i.half));
  const l = SAE_INTERIOR.ledgerShelf;
  colliders.push(box(l.x, l.z, l.halfWidth, l.halfDepth));
  const s = SAE_INTERIOR.stairs;
  colliders.push(box(s.x, s.z, s.halfWidth, s.halfDepth));
  for (const p of SAE_INTERIOR.posts) colliders.push({ kind: 'circle', x: p.x, z: p.z, radius: 0.2 });
  for (const o of SAE_INTERIOR.storage) {
    colliders.push('radius' in o ? { kind: 'circle', x: o.x, z: o.z, radius: o.radius } : box(o.x, o.z, o.halfWidth, o.halfDepth));
  }
  return colliders;
}
