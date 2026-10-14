/** 水平面（XZ平面）上の座標。Three.js に依存しない純粋な値型。 */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 角度を (-π, π] に正規化する。 */
export function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/**
 * フレームレートに依存しない指数減衰補間の係数。
 * `rate` は 1 秒あたりの追従の強さ。dt が分割されても結果が一致する。
 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * damp(rate, dt);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
