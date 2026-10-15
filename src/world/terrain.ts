import { smoothstep } from '../core/math';
import { BRIDGE, WATERWAY } from './layout';
import { SAE_INTERIOR, isInsideSaeHouse } from './saeInterior';
import { WORKSHOP, isOnWorkshopFloor } from './workshop';

/**
 * 地形の高さ（決定的な純粋関数）。
 * 地形メッシュの生成とプレイヤーの接地の両方で使い、見た目と位置のずれを防ぐ。
 */
export function terrainHeight(x: number, z: number): number {
  // 村の中のゆるやかな起伏（既存試作の sin/cos 起伏を弱めて流用）
  let h = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 0.35 + Math.sin((x + z) * 0.13) * 0.08;

  // 外周の山すそ
  const r = Math.hypot(x * 0.95, z + 3);
  h += smoothstep(50, 120, r) * 28 + Math.sin(x * 0.08) * Math.cos(z * 0.07) * smoothstep(55, 90, r) * 3;

  // 南の水路（東西に流れる溝）
  const dz = Math.abs(z - WATERWAY.centerZ);
  h -= 1.0 * (1 - smoothstep(WATERWAY.halfWidth - 0.5, WATERWAY.halfWidth + 0.5, dz));

  return h;
}

/** 橋の上かどうか（歩行面の判定用）。 */
export function isOnBridge(x: number, z: number): boolean {
  return Math.abs(x - BRIDGE.x) <= BRIDGE.halfWidth + 0.2 && z >= BRIDGE.startZ && z <= BRIDGE.endZ;
}

/** 橋の床面の高さ（ゆるいアーチ）。 */
export function bridgeDeckHeight(z: number): number {
  const t = (z - BRIDGE.startZ) / (BRIDGE.endZ - BRIDGE.startZ);
  return BRIDGE.baseHeight + Math.sin(Math.PI * t) * BRIDGE.archHeight;
}

/** サエ家の室内の床の高さ（家の足元の地形の高さ＋土台の高さ。室内は平らな床）。 */
export const SAE_FLOOR_Y = terrainHeight(0, 0) + SAE_INTERIOR.floorLift;

/** 宗平の作業場の床の高さ（土台の上の平らな床。Phase 6.5）。 */
export const WORKSHOP_FLOOR_Y = terrainHeight(WORKSHOP.center.x, WORKSHOP.center.z) + WORKSHOP.floorLift;

/** キャラクターが立つ面の高さ。地形と橋のうち高い方。サエ家の室内は平らな床。 */
export function groundHeight(x: number, z: number): number {
  if (isInsideSaeHouse(x, z)) return SAE_FLOOR_Y;
  if (isOnWorkshopFloor(x, z)) return WORKSHOP_FLOOR_Y;
  const t = terrainHeight(x, z);
  return isOnBridge(x, z) ? Math.max(t, bridgeDeckHeight(z)) : t;
}
