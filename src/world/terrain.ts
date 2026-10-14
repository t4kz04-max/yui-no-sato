import { smoothstep } from '../core/math';
import { BRIDGE, WATERWAY } from './layout';

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

/** キャラクターが立つ面の高さ。地形と橋のうち高い方。 */
export function groundHeight(x: number, z: number): number {
  const t = terrainHeight(x, z);
  return isOnBridge(x, z) ? Math.max(t, bridgeDeckHeight(z)) : t;
}
