import { resolveCircle, type Bounds, type Collider } from '../core/collision';
import { damp, dampAngle, type Vec2 } from '../core/math';

/**
 * プレイヤー移動の純粋ロジック。Three.js にも DOM にも依存しない。
 * すべて経過時間 dt（秒）に基づくため、フレームレートが変わっても速度は同じ。
 */

export interface PlayerTuning {
  readonly walkSpeed: number; // m/s
  readonly runSpeed: number; // m/s
  readonly acceleration: number; // 速度の追従の強さ（1/s）
  readonly turnRate: number; // 向きの追従の強さ（1/s）
  readonly radius: number; // 当たり判定の半径
}

export const DEFAULT_PLAYER_TUNING: PlayerTuning = {
  walkSpeed: 4.2,
  runSpeed: 7.5,
  acceleration: 14,
  turnRate: 12,
  radius: 0.35,
};

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** 体の向き（rotation.y）。0 で +Z を向く。 */
  heading: number;
  velocityX: number;
  velocityZ: number;
}

/** 1フレーム分の移動入力。カメラ基準の前後左右。値は -1〜1。 */
export interface MoveIntent {
  readonly forward: number;
  readonly right: number;
  readonly run: boolean;
}

/** プレイヤーが歩く世界に関する情報。描画とは無関係なデータだけを受け取る。 */
export interface WalkableWorld {
  readonly colliders: readonly Collider[];
  readonly bounds: Bounds;
  groundHeight(x: number, z: number): number;
}

export function createPlayerState(start: Vec2, heading: number, world: WalkableWorld): PlayerState {
  return { x: start.x, y: world.groundHeight(start.x, start.z), z: start.z, heading, velocityX: 0, velocityZ: 0 };
}

/**
 * カメラの水平角 yaw を基準に、入力をワールド方向へ変換する。
 * カメラは「プレイヤー − forward × 距離」の位置にあるため、forward は画面奥方向。
 */
export function intentToWorldDirection(intent: MoveIntent, cameraYaw: number): Vec2 {
  const fx = Math.sin(cameraYaw);
  const fz = Math.cos(cameraYaw);
  // 画面右方向（forward を上から見て時計回りに 90°）
  const rx = -fz;
  const rz = fx;
  let x = fx * intent.forward + rx * intent.right;
  let z = fz * intent.forward + rz * intent.right;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z };
}

export function speedOf(state: PlayerState): number {
  return Math.hypot(state.velocityX, state.velocityZ);
}

export function updatePlayer(
  state: PlayerState,
  intent: MoveIntent,
  cameraYaw: number,
  dt: number,
  world: WalkableWorld,
  tuning: PlayerTuning = DEFAULT_PLAYER_TUNING,
): void {
  const dir = intentToWorldDirection(intent, cameraYaw);
  const maxSpeed = intent.run ? tuning.runSpeed : tuning.walkSpeed;
  const targetVX = dir.x * maxSpeed;
  const targetVZ = dir.z * maxSpeed;

  // 速度は目標速度へ指数的に近づく。その間の移動量を解析的に積分するので、
  // dt の刻み方によらず同じ距離だけ進む。
  const k = tuning.acceleration;
  const a = damp(k, dt);
  const ramp = k > 0 ? a / k : 0;
  const dx = targetVX * dt + (state.velocityX - targetVX) * ramp;
  const dz = targetVZ * dt + (state.velocityZ - targetVZ) * ramp;
  state.velocityX += (targetVX - state.velocityX) * a;
  state.velocityZ += (targetVZ - state.velocityZ) * a;

  const intended = { x: state.x + dx, z: state.z + dz };
  const resolved = resolveCircle(intended, tuning.radius, world.colliders, world.bounds);

  // 障害物に押し戻されたときは、速度も実際の移動に合わせる（壁に向かって加速し続けない）
  const blocked = Math.abs(resolved.x - intended.x) > 1e-9 || Math.abs(resolved.z - intended.z) > 1e-9;
  if (blocked && dt > 0) {
    state.velocityX = (resolved.x - state.x) / dt;
    state.velocityZ = (resolved.z - state.z) / dt;
  }
  state.x = resolved.x;
  state.z = resolved.z;
  state.y = world.groundHeight(state.x, state.z);

  if (dir.x !== 0 || dir.z !== 0) {
    state.heading = dampAngle(state.heading, Math.atan2(dir.x, dir.z), tuning.turnRate, dt);
  }
}
