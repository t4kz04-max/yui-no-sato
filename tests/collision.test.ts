import { describe, expect, it } from 'vitest';
import { overlapsAny, penetration, resolveCircle, type Collider } from '../src/core/collision';

describe('penetration', () => {
  it('離れている円同士は押し出さない', () => {
    const c: Collider = { kind: 'circle', x: 0, z: 0, radius: 1 };
    expect(penetration({ x: 3, z: 0 }, 0.5, c)).toBeNull();
  });

  it('重なった円を中心から遠ざける方向に押し出す', () => {
    const c: Collider = { kind: 'circle', x: 0, z: 0, radius: 1 };
    const p = penetration({ x: 1.2, z: 0 }, 0.5, c);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0.3);
    expect(p!.z).toBeCloseTo(0);
  });

  it('矩形の外側から接触した円を辺の法線方向へ押し出す', () => {
    const c: Collider = { kind: 'box', x: 0, z: 0, halfWidth: 2, halfDepth: 1, rotation: 0 };
    const p = penetration({ x: 0, z: 1.2 }, 0.5, c);
    expect(p!.x).toBeCloseTo(0);
    expect(p!.z).toBeCloseTo(0.3);
  });

  it('中心が矩形内部にあるときは最も近い辺から外へ出す', () => {
    const c: Collider = { kind: 'box', x: 0, z: 0, halfWidth: 2, halfDepth: 1, rotation: 0 };
    const p = penetration({ x: 1.8, z: 0 }, 0.5, c);
    expect(p!.x).toBeCloseTo(0.7);
    expect(p!.z).toBeCloseTo(0);
  });

  it('回転した矩形の向きを正しく扱う', () => {
    // 90°回転すると、ローカル X（幅4）はワールド Z 方向になる
    const c: Collider = { kind: 'box', x: 10, z: 0, halfWidth: 2, halfDepth: 0.5, rotation: Math.PI / 2 };
    expect(penetration({ x: 10, z: 2.3 }, 0.5, c)).not.toBeNull();
    expect(penetration({ x: 11.2, z: 0 }, 0.5, c)).toBeNull();
  });
});

describe('resolveCircle', () => {
  const wall: Collider = { kind: 'box', x: 0, z: 0, halfWidth: 5, halfDepth: 1, rotation: 0 };

  it('壁にめり込んだ位置を壁の外側へ戻す', () => {
    const r = resolveCircle({ x: 0, z: 1.1 }, 0.4, [wall]);
    expect(r.z).toBeCloseTo(1.4);
    expect(overlapsAny(r, 0.39, [wall])).toBe(false);
  });

  it('複数の障害物に挟まれても、すべてから押し出される', () => {
    const a: Collider = { kind: 'circle', x: -1, z: 0, radius: 1 };
    const b: Collider = { kind: 'circle', x: 1.6, z: 0, radius: 1 };
    const r = resolveCircle({ x: 0.3, z: 0.5 }, 0.3, [a, b], undefined, 8);
    expect(overlapsAny(r, 0.29, [a, b])).toBe(false);
  });

  it('歩行範囲の外に出さない', () => {
    const r = resolveCircle({ x: 100, z: -100 }, 0.5, [], { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
    expect(r).toEqual({ x: 9.5, z: -9.5 });
  });
});
