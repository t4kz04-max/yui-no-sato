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

export interface CollisionMapSource {
  readonly buildings: readonly BuildingDef[];
  readonly props: readonly PropDef[];
  readonly trees: readonly TreeDef[];
}

export function buildCollisionMap(src: CollisionMapSource): Collider[] {
  const colliders: Collider[] = [];
  for (const b of src.buildings) colliders.push(buildingCollider(b));
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
  colliders.push(...waterwayColliders());
  return colliders;
}
