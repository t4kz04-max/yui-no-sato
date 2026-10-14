import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORBIT_LIMITS,
  applyOrbitInput,
  createOrbitState,
  orbitOffset,
} from '../src/camera/orbit';
import { clampFrameDt, MAX_FRAME_DT } from '../src/core/GameLoop';

describe('orbitOffset', () => {
  it('オフセットの長さは距離と等しい', () => {
    const o = orbitOffset(1.2, 0.5, 10);
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(10);
  });

  it('yaw=π のときカメラはプレイヤーの南（+Z）側にあり、北を向く', () => {
    const o = orbitOffset(Math.PI, 0.3, 10);
    expect(o.z).toBeGreaterThan(0);
    expect(Math.abs(o.x)).toBeLessThan(1e-9);
    expect(o.y).toBeGreaterThan(0);
  });
});

describe('applyOrbitInput', () => {
  it('ズームは上限・下限の範囲に収まる', () => {
    const s = createOrbitState(0);
    for (let i = 0; i < 100; i++) applyOrbitInput(s, { lookX: 0, lookY: 0, zoom: 1000 }, 1 / 60);
    expect(s.targetDistance).toBe(DEFAULT_ORBIT_LIMITS.maxDistance);
    expect(s.distance).toBeCloseTo(DEFAULT_ORBIT_LIMITS.maxDistance, 1);
    for (let i = 0; i < 100; i++) applyOrbitInput(s, { lookX: 0, lookY: 0, zoom: -1000 }, 1 / 60);
    expect(s.targetDistance).toBe(DEFAULT_ORBIT_LIMITS.minDistance);
  });

  it('上下の角度は制限される（真上・地面の下に回り込まない）', () => {
    const s = createOrbitState(0);
    applyOrbitInput(s, { lookX: 0, lookY: 100000, zoom: 0 }, 1 / 60);
    expect(s.targetPitch).toBe(DEFAULT_ORBIT_LIMITS.maxPitch);
    applyOrbitInput(s, { lookX: 0, lookY: -100000, zoom: 0 }, 1 / 60);
    expect(s.targetPitch).toBe(DEFAULT_ORBIT_LIMITS.minPitch);
  });

  it('右へドラッグすると右を向く（yaw が減る）', () => {
    const s = createOrbitState(Math.PI);
    applyOrbitInput(s, { lookX: 100, lookY: 0, zoom: 0 }, 1);
    expect(s.yaw).toBeLessThan(Math.PI);
  });
});

describe('clampFrameDt', () => {
  it('タブ復帰時などの巨大な経過時間を上限で切る', () => {
    expect(clampFrameDt(5)).toBe(MAX_FRAME_DT);
    expect(clampFrameDt(-1)).toBe(0);
    expect(clampFrameDt(Number.NaN)).toBe(0);
    expect(clampFrameDt(0.016)).toBeCloseTo(0.016);
  });
});
