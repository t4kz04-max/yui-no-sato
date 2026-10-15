import type { Collider } from '../core/collision';
import {
  BRIDGE,
  BUILDING_FOOTPRINT,
  FIELD,
  PROP_FOOTPRINT,
  TREE_TRUNK_RADIUS,
  WATERWAY,
  WALK_BOUNDS,
  type BuildingDef,
  type PropDef,
  type TreeDef,
} from './layout';
import { workshopColliders } from './workshop';

/**
 * 配置データから当たり判定を生成する。
 * 描画メッシュと同じ配置データを元にするため、見た目と判定がずれない
 * （既存試作では Box3 の計算タイミングにより、全建物の判定が原点付近に作られていた）。
 */
export function buildingCollider(b: BuildingDef): Collider {
  const fp = BUILDING_FOOTPRINT[b.kind];
  return {
    kind: 'box',
    x: b.position.x,
    z: b.position.z,
    halfWidth: fp.halfWidth * b.scale,
    halfDepth: fp.halfDepth * b.scale,
    rotation: b.rotation,
  };
}

export function propCollider(p: PropDef): Collider | null {
  const fp = PROP_FOOTPRINT[p.kind];
  if (!fp) return null;
  const s = p.scale ?? 1;
  if ('radius' in fp) {
    return { kind: 'circle', x: p.position.x, z: p.position.z, radius: fp.radius * s };
  }
  return {
    kind: 'box',
    x: p.position.x,
    z: p.position.z,
    halfWidth: fp.halfWidth * s,
    halfDepth: fp.halfDepth * s,
    rotation: p.rotation,
  };
}

export function treeCollider(t: TreeDef): Collider {
  return { kind: 'circle', x: t.position.x, z: t.position.z, radius: TREE_TRUNK_RADIUS * t.scale };
}

/** 水路は橋の部分を除いて通行不可にする。 */
export function waterwayColliders(): Collider[] {
  const ranges = [
    { min: WATERWAY.minX, max: BRIDGE.x - BRIDGE.halfWidth },
    { min: BRIDGE.x + BRIDGE.halfWidth, max: WATERWAY.maxX },
  ];
  return ranges.map((r) => ({
    kind: 'box' as const,
    x: (r.min + r.max) / 2,
    z: WATERWAY.centerZ,
    halfWidth: (r.max - r.min) / 2,
    halfDepth: WATERWAY.halfWidth,
    rotation: 0,
  }));
}

/** 欄干の判定の半分の厚み。 */
export const BRIDGE_RAIL_HALF_THICKNESS = 0.1;
/** 欄干の内側の面（橋の中心線から）。描画の欄干（environment.ts の createBridge）と同じ位置。 */
export const BRIDGE_RAIL_X = BRIDGE.halfWidth + 0.08;

/**
 * 橋の左右の欄干と、橋のたもとの石（Phase 5.5）。
 * 水路の判定は水の幅しか塞がないため、欄干の両端（地面と橋が接する所）では横へ抜けられた。
 * 欄干の全長に沿って判定を置き、入口と出口（橋の両端）は開けておく。
 */
export function bridgeColliders(): Collider[] {
  const len = BRIDGE.endZ - BRIDGE.startZ;
  // 描画の欄干は startZ + 0.3 〜 endZ - 0.3。柱の太さの分だけ両端を延ばす
  const railHalfDepth = (len - 0.6) / 2 + 0.1;
  const midZ = (BRIDGE.startZ + BRIDGE.endZ) / 2;
  const rails: Collider[] = [-1, 1].map((side) => ({
    kind: 'box' as const,
    x: BRIDGE.x + side * BRIDGE_RAIL_X,
    z: midZ,
    halfWidth: BRIDGE_RAIL_HALF_THICKNESS,
    halfDepth: railHalfDepth,
    rotation: 0,
  }));
  const stones: Collider[] = [];
  for (const z of [BRIDGE.startZ - 0.3, BRIDGE.endZ + 0.3]) {
    for (const side of [-1, 1]) {
      stones.push({ kind: 'box', x: BRIDGE.x + side * (BRIDGE.halfWidth + 0.35), z, halfWidth: 0.25, halfDepth: 0.25, rotation: 0 });
    }
  }
  return [...rails, ...stones];
}

export interface CollisionMapSource {
  readonly buildings: readonly BuildingDef[];
  readonly props: readonly PropDef[];
  readonly trees: readonly TreeDef[];
}

export function buildCollisionMap(src: CollisionMapSource): Collider[] {
  const colliders: Collider[] = [];
  // 宗平の作業場は外形の箱ではなく、壁と中の物ごとの判定にする（正面から入れる。Phase 6.5）
  for (const b of src.buildings) {
    if (b.kind === 'workshop') colliders.push(...workshopColliders());
    else colliders.push(buildingCollider(b));
  }
  for (const p of src.props) {
    const c = propCollider(p);
    if (c) colliders.push(c);
  }
  // 歩行範囲から十分外れた木は判定不要
  const margin = 3;
  for (const t of src.trees) {
    const { x, z } = t.position;
    if (
      x > WALK_BOUNDS.minX - margin &&
      x < WALK_BOUNDS.maxX + margin &&
      z > WALK_BOUNDS.minZ - margin &&
      z < WALK_BOUNDS.maxZ + margin
    ) {
      colliders.push(treeCollider(t));
    }
  }
  // 畑（作物を踏み荒らさない）
  colliders.push({
    kind: 'box',
    x: FIELD.position.x,
    z: FIELD.position.z,
    halfWidth: FIELD.halfWidth,
    halfDepth: FIELD.halfDepth,
    rotation: 0,
  });
  colliders.push(...waterwayColliders(), ...bridgeColliders());
  return colliders;
}
