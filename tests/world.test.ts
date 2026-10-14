import { describe, expect, it } from 'vitest';
import { overlapsAny, penetration } from '../src/core/collision';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { buildCollisionMap, buildingCollider } from '../src/world/collisionMap';
import {
  BRIDGE,
  BUILDINGS,
  LOCATIONS,
  PATHS,
  PLAYER_START,
  PROPS,
  TREES,
  WALK_BOUNDS,
  WATERWAY,
  distanceToSegment,
} from '../src/world/layout';
import { bridgeDeckHeight, groundHeight, terrainHeight } from '../src/world/terrain';

const colliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
const radius = DEFAULT_PLAYER_TUNING.radius;

describe('当たり判定マップ', () => {
  it('各建物の判定は、その建物の位置に作られる（既存試作の原点バグの回帰テスト）', () => {
    for (const b of BUILDINGS) {
      const c = buildingCollider(b);
      expect(c.x).toBe(b.position.x);
      expect(c.z).toBe(b.position.z);
      // 建物の中心には立てない
      expect(penetration(b.position, radius, c)).not.toBeNull();
    }
  });

  it('スタート地点は障害物と重なっていない', () => {
    expect(overlapsAny(PLAYER_START.position, radius, colliders)).toBe(false);
  });

  it('水路は橋以外では渡れず、橋の上は通れる', () => {
    expect(overlapsAny({ x: 10, z: WATERWAY.centerZ }, radius, colliders)).toBe(true);
    expect(overlapsAny({ x: BRIDGE.x, z: WATERWAY.centerZ }, radius, colliders)).toBe(false);
  });

  it('道の上に木や小物の判定が置かれていない', () => {
    for (const c of colliders) {
      if (c.kind !== 'circle') continue;
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          const a = path.points[i]!;
          const b = path.points[i + 1]!;
          expect(distanceToSegment(c.x, c.z, a, b)).toBeGreaterThan(c.radius + 0.2);
        }
      }
    }
  });
});

describe('到達可能性', () => {
  // 0.5m 間隔の格子で、スタート地点から歩いて行ける範囲を塗りつぶす
  const step = 0.5;
  const nx = Math.floor((WALK_BOUNDS.maxX - WALK_BOUNDS.minX) / step);
  const nz = Math.floor((WALK_BOUNDS.maxZ - WALK_BOUNDS.minZ) / step);
  const toX = (i: number) => WALK_BOUNDS.minX + i * step;
  const toZ = (j: number) => WALK_BOUNDS.minZ + j * step;
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = toX(i);
      const z = toZ(j);
      const inBounds =
        x >= WALK_BOUNDS.minX + radius &&
        x <= WALK_BOUNDS.maxX - radius &&
        z >= WALK_BOUNDS.minZ + radius &&
        z <= WALK_BOUNDS.maxZ - radius;
      free[j * nx + i] = inBounds && !overlapsAny({ x, z }, radius, colliders) ? 1 : 0;
    }
  }
  const reached = new Uint8Array(nx * nz);
  const si = Math.round((PLAYER_START.position.x - WALK_BOUNDS.minX) / step);
  const sj = Math.round((PLAYER_START.position.z - WALK_BOUNDS.minZ) / step);
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

  it.each(LOCATIONS.map((l) => [l.label, l] as const))('スタート地点から「%s」の近くまで歩いて行ける', (_, loc) => {
    let best = Infinity;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!reached[j * nx + i]) continue;
        best = Math.min(best, Math.hypot(toX(i) - loc.position.x, toZ(j) - loc.position.z));
      }
    }
    // 建物の中心を地点としているので、建物の大きさ＋数mまで近づければよい
    expect(best).toBeLessThan(10);
  });

  it('村の歩ける範囲の大部分が、スタート地点からつながっている', () => {
    let freeCount = 0;
    let reachedCount = 0;
    for (let k = 0; k < free.length; k++) {
      freeCount += free[k]!;
      reachedCount += reached[k]!;
    }
    expect(reachedCount / freeCount).toBeGreaterThan(0.97);
  });
});

describe('地形', () => {
  it('決定的で有限の値を返す', () => {
    for (let x = -140; x <= 140; x += 7) {
      for (let z = -140; z <= 140; z += 7) {
        const h = terrainHeight(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(terrainHeight(x, z)).toBe(h);
      }
    }
  });

  it('水路は両岸より低く、水面は水路の底より高い', () => {
    const bank = terrainHeight(10, WATERWAY.centerZ - 4);
    const bed = terrainHeight(10, WATERWAY.centerZ);
    expect(bed).toBeLessThan(bank - 0.5);
    expect(WATERWAY.waterLevel).toBeGreaterThan(bed);
  });

  it('橋の上では床面に立ち、床面は両端で岸とおおむね同じ高さ', () => {
    const mid = (BRIDGE.startZ + BRIDGE.endZ) / 2;
    expect(groundHeight(BRIDGE.x, mid)).toBeCloseTo(bridgeDeckHeight(mid));
    expect(groundHeight(BRIDGE.x, mid)).toBeGreaterThan(WATERWAY.waterLevel + 0.3);
    for (const z of [BRIDGE.startZ, BRIDGE.endZ]) {
      expect(Math.abs(bridgeDeckHeight(z) - terrainHeight(BRIDGE.x, z))).toBeLessThan(0.3);
    }
  });

  it('歩ける範囲の起伏はゆるやか（探索の妨げになる急斜面がない）', () => {
    let maxSlope = 0;
    for (let x = WALK_BOUNDS.minX; x < WALK_BOUNDS.maxX; x += 1) {
      for (let z = WALK_BOUNDS.minZ; z < WALK_BOUNDS.maxZ; z += 1) {
        if (Math.abs(z - WATERWAY.centerZ) < WATERWAY.halfWidth + 1) continue;
        const dx = groundHeight(x + 0.5, z) - groundHeight(x - 0.5, z);
        const dz = groundHeight(x, z + 0.5) - groundHeight(x, z - 0.5);
        maxSlope = Math.max(maxSlope, Math.hypot(dx, dz));
      }
    }
    // 勾配 0.5（約27°）未満
    expect(maxSlope).toBeLessThan(0.5);
  });
});
