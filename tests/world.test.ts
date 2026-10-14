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
import { buildReachability } from './helpers/reachability';
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
  const map = buildReachability(colliders, WALK_BOUNDS, PLAYER_START.position, radius);

  it.each(LOCATIONS.map((l) => [l.label, l] as const))('スタート地点から「%s」の近くまで歩いて行ける', (_, loc) => {
    // 建物の中心を地点としているので、建物の大きさ＋数mまで近づければよい
    expect(map.nearestReachable(loc.position)).toBeLessThan(10);
  });

  it('村の歩ける範囲の大部分が、スタート地点からつながっている', () => {
    expect(map.reachedCount / map.freeCount).toBeGreaterThan(0.97);
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
        // サエ家の室内は平らな床（外からは壁で入れない。境目の段差は対象外）
        if (Math.abs(x) < 9.5 && Math.abs(z) < 7) continue;
        const dx = groundHeight(x + 0.5, z) - groundHeight(x - 0.5, z);
        const dz = groundHeight(x, z + 0.5) - groundHeight(x, z - 0.5);
        maxSlope = Math.max(maxSlope, Math.hypot(dx, dz));
      }
    }
    // 勾配 0.5（約27°）未満
    expect(maxSlope).toBeLessThan(0.5);
  });
});
