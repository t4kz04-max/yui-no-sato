import { overlapsAny, type Bounds, type Collider } from '../../src/core/collision';
import type { Vec2 } from '../../src/core/math';

/**
 * 格子（既定 0.5m 間隔）で、スタート地点から歩いて行ける範囲を塗りつぶす。
 * 到達可能性のテスト（地点・住民・調査対象に近づけるか）で共通に使う。
 */
export interface ReachabilityMap {
  readonly freeCount: number;
  readonly reachedCount: number;
  /** point に最も近い到達可能な格子点までの距離。 */
  nearestReachable(point: Vec2): number;
}

export function buildReachability(
  colliders: readonly Collider[],
  bounds: Bounds,
  start: Vec2,
  radius: number,
  step = 0.5,
): ReachabilityMap {
  const nx = Math.floor((bounds.maxX - bounds.minX) / step);
  const nz = Math.floor((bounds.maxZ - bounds.minZ) / step);
  const toX = (i: number) => bounds.minX + i * step;
  const toZ = (j: number) => bounds.minZ + j * step;
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = toX(i);
      const z = toZ(j);
      const inBounds =
        x >= bounds.minX + radius && x <= bounds.maxX - radius && z >= bounds.minZ + radius && z <= bounds.maxZ - radius;
      free[j * nx + i] = inBounds && !overlapsAny({ x, z }, radius, colliders) ? 1 : 0;
    }
  }
  const reached = new Uint8Array(nx * nz);
  const si = Math.round((start.x - bounds.minX) / step);
  const sj = Math.round((start.z - bounds.minZ) / step);
  const queue: number[] = [sj * nx + si];
  reached[sj * nx + si] = 1;
  while (queue.length) {
    const idx = queue.pop()!;
    const i = idx % nx;
    const j = (idx - i) / nx;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (free[n] && !reached[n]) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  let freeCount = 0;
  let reachedCount = 0;
  for (let k = 0; k < free.length; k++) {
    freeCount += free[k]!;
    reachedCount += reached[k]!;
  }
  return {
    freeCount,
    reachedCount,
    nearestReachable(point) {
      let best = Infinity;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          if (!reached[j * nx + i]) continue;
          best = Math.min(best, Math.hypot(toX(i) - point.x, toZ(j) - point.z));
        }
      }
      return best;
    },
  };
}
