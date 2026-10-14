import { clamp, type Vec2 } from './math';

/**
 * 当たり判定は XZ 平面上の 2D 形状で扱う。
 * ジャンプのない探索ゲームなので、高さ方向の判定は不要。
 */
export interface CircleCollider {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** 回転付きの矩形。rotation は Three.js の rotation.y と同じ向き。 */
export interface BoxCollider {
  readonly kind: 'box';
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number; // ローカル X 方向
  readonly halfDepth: number; // ローカル Z 方向
  readonly rotation: number;
}

export type Collider = CircleCollider | BoxCollider;

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** 円と1つのコライダーの重なりを解消するための押し出し量。重なっていなければ null。 */
export function penetration(pos: Vec2, radius: number, c: Collider): Vec2 | null {
  if (c.kind === 'circle') {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const minDist = radius + c.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist) return null;
    const dist = Math.sqrt(distSq);
    if (dist < 1e-9) return { x: minDist, z: 0 };
    const push = minDist - dist;
    return { x: (dx / dist) * push, z: (dz / dist) * push };
  }

  // ワールド座標 → 矩形ローカル座標（rotation.y の逆回転）
  const cos = Math.cos(c.rotation);
  const sin = Math.sin(c.rotation);
  const wx = pos.x - c.x;
  const wz = pos.z - c.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;

  const cx = clamp(lx, -c.halfWidth, c.halfWidth);
  const cz = clamp(lz, -c.halfDepth, c.halfDepth);
  let px: number;
  let pz: number;

  if (cx === lx && cz === lz) {
    // 中心が矩形の内部：最も浅い辺から押し出す
    const toRight = c.halfWidth - lx;
    const toLeft = lx + c.halfWidth;
    const toFront = c.halfDepth - lz;
    const toBack = lz + c.halfDepth;
    const m = Math.min(toRight, toLeft, toFront, toBack);
    px = 0;
    pz = 0;
    if (m === toRight) px = toRight + radius;
    else if (m === toLeft) px = -(toLeft + radius);
    else if (m === toFront) pz = toFront + radius;
    else pz = -(toBack + radius);
  } else {
    const dx = lx - cx;
    const dz = lz - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) return null;
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    px = (dx / dist) * push;
    pz = (dz / dist) * push;
  }

  // ローカル → ワールド
  return { x: px * cos + pz * sin, z: -px * sin + pz * cos };
}

/** 円（プレイヤー等）をすべてのコライダーと境界から押し出した位置を返す。 */
export function resolveCircle(
  pos: Vec2,
  radius: number,
  colliders: readonly Collider[],
  bounds?: Bounds,
  iterations = 4,
): Vec2 {
  let x = pos.x;
  let z = pos.z;
  for (let i = 0; i < iterations; i++) {
    let moved = false;
    for (const c of colliders) {
      const p = penetration({ x, z }, radius, c);
      if (p) {
        x += p.x;
        z += p.z;
        moved = true;
      }
    }
    if (bounds) {
      x = clamp(x, bounds.minX + radius, bounds.maxX - radius);
      z = clamp(z, bounds.minZ + radius, bounds.maxZ - radius);
    }
    if (!moved) break;
  }
  return { x, z };
}

export function overlapsAny(pos: Vec2, radius: number, colliders: readonly Collider[]): boolean {
  return colliders.some((c) => penetration(pos, radius, c) !== null);
}
