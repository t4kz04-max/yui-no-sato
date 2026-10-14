import { describe, expect, it } from 'vitest';
import type { Collider } from '../src/core/collision';
import {
  DEFAULT_PLAYER_TUNING,
  createPlayerState,
  intentToWorldDirection,
  speedOf,
  updatePlayer,
  type MoveIntent,
  type WalkableWorld,
} from '../src/player/PlayerController';

const flatWorld = (colliders: Collider[] = []): WalkableWorld => ({
  colliders,
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  groundHeight: () => 0,
});

const forward: MoveIntent = { forward: 1, right: 0, run: false };

function simulate(seconds: number, dt: number, intent: MoveIntent, yaw: number, world = flatWorld()) {
  const s = createPlayerState({ x: 0, z: 0 }, 0, world);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) updatePlayer(s, intent, yaw, dt, world);
  return s;
}

describe('intentToWorldDirection', () => {
  it('yaw=π（北向き）で前進すると -Z、右入力で +X（東）へ向かう', () => {
    const f = intentToWorldDirection({ forward: 1, right: 0, run: false }, Math.PI);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    const r = intentToWorldDirection({ forward: 0, right: 1, run: false }, Math.PI);
    expect(r.x).toBeCloseTo(1);
    expect(r.z).toBeCloseTo(0);
  });

  it('斜め入力でも速さが1を超えない', () => {
    const d = intentToWorldDirection({ forward: 1, right: 1, run: false }, 0.3);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });
});

describe('updatePlayer', () => {
  it('移動距離がフレームレートに依存しない（30fps と 144fps でほぼ同じ）', () => {
    const a = simulate(2, 1 / 30, forward, 0);
    const b = simulate(2, 1 / 144, forward, 0);
    expect(Math.abs(a.z - b.z)).toBeLessThan(0.01);
    // 歩く速さ × 2秒（加速分を差し引いて）程度
    expect(a.z).toBeGreaterThan(DEFAULT_PLAYER_TUNING.walkSpeed * 2 - 0.5);
    expect(a.z).toBeLessThanOrEqual(DEFAULT_PLAYER_TUNING.walkSpeed * 2);
  });

  it('Shift で走ると歩くより速い', () => {
    const walk = simulate(1, 1 / 60, forward, 0);
    const run = simulate(1, 1 / 60, { ...forward, run: true }, 0);
    expect(run.z).toBeGreaterThan(walk.z * 1.5);
  });

  it('入力をやめると止まる', () => {
    const world = flatWorld();
    const s = simulate(1, 1 / 60, forward, 0, world);
    for (let i = 0; i < 60; i++) updatePlayer(s, { forward: 0, right: 0, run: false }, 0, 1 / 60, world);
    expect(speedOf(s)).toBeLessThan(0.01);
  });

  it('壁をすり抜けない（速く走り続けても、大きな dt でも）', () => {
    const wall: Collider = { kind: 'box', x: 0, z: 5, halfWidth: 10, halfDepth: 0.5, rotation: 0 };
    const world = flatWorld([wall]);
    const s = simulate(5, 0.1, { ...forward, run: true }, 0, world);
    expect(s.z).toBeLessThanOrEqual(5 - 0.5 - DEFAULT_PLAYER_TUNING.radius + 1e-6);
  });

  it('壁に沿って滑るように移動できる', () => {
    const wall: Collider = { kind: 'box', x: 0, z: 2, halfWidth: 50, halfDepth: 0.5, rotation: 0 };
    const world = flatWorld([wall]);
    // 北東（+X と +Z の間）へ進むと、壁に当たった後は +X 方向に滑る
    const s = simulate(3, 1 / 60, { forward: 1, right: -1, run: false }, 0, world);
    expect(s.z).toBeLessThan(2);
    expect(s.x).toBeGreaterThan(5);
  });

  it('地面の高さに追従する', () => {
    const world: WalkableWorld = { ...flatWorld(), groundHeight: (x) => x * 0.1 };
    const s = createPlayerState({ x: 0, z: 0 }, 0, world);
    for (let i = 0; i < 120; i++) updatePlayer(s, { forward: 0, right: -1, run: false }, 0, 1 / 60, world);
    expect(s.x).toBeGreaterThan(1);
    expect(s.y).toBeCloseTo(s.x * 0.1);
  });

  it('移動方向へ体の向きが回る', () => {
    const s = simulate(1, 1 / 60, { forward: 0, right: 1, run: false }, 0);
    // yaw=0 で右入力 → -X 方向。atan2(-1, 0) = -π/2
    expect(s.heading).toBeCloseTo(-Math.PI / 2, 1);
  });
});
