import { clamp, damp, dampAngle, type Vec3 } from '../core/math';

/**
 * 三人称カメラの軌道パラメータと計算。Three.js 非依存でテスト可能。
 *
 * yaw   : 水平角。カメラはプレイヤーから見て -forward(yaw) 側に位置する。
 * pitch : 見下ろし角（ラジアン）。
 * distance : 注視点からの距離。
 */
export interface OrbitLimits {
  readonly minPitch: number;
  readonly maxPitch: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export const DEFAULT_ORBIT_LIMITS: OrbitLimits = {
  minPitch: 0.05,
  maxPitch: 1.35,
  minDistance: 3.5,
  maxDistance: 22,
};

export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  /** 入力による目標値。表示値は目標値へ滑らかに追従する。 */
  targetYaw: number;
  targetPitch: number;
  targetDistance: number;
}

export function createOrbitState(yaw: number, pitch = 0.42, distance = 10): OrbitState {
  return { yaw, pitch, distance, targetYaw: yaw, targetPitch: pitch, targetDistance: distance };
}

export interface OrbitInput {
  /** マウス移動量（ピクセル）。 */
  readonly lookX: number;
  readonly lookY: number;
  /** ホイール量（正でズームアウト）。 */
  readonly zoom: number;
}

export interface OrbitSettings {
  readonly lookSensitivity: number; // rad / px
  readonly zoomSensitivity: number; // m / wheel delta
  readonly smoothing: number; // 1/s
}

export const DEFAULT_ORBIT_SETTINGS: OrbitSettings = {
  lookSensitivity: 0.005,
  zoomSensitivity: 0.012,
  smoothing: 18,
};

export function applyOrbitInput(
  state: OrbitState,
  input: OrbitInput,
  dt: number,
  settings: OrbitSettings = DEFAULT_ORBIT_SETTINGS,
  limits: OrbitLimits = DEFAULT_ORBIT_LIMITS,
): void {
  state.targetYaw -= input.lookX * settings.lookSensitivity;
  state.targetPitch = clamp(state.targetPitch + input.lookY * settings.lookSensitivity, limits.minPitch, limits.maxPitch);
  state.targetDistance = clamp(
    state.targetDistance + input.zoom * settings.zoomSensitivity,
    limits.minDistance,
    limits.maxDistance,
  );

  state.yaw = dampAngle(state.yaw, state.targetYaw, settings.smoothing, dt);
  state.pitch += (state.targetPitch - state.pitch) * damp(settings.smoothing, dt);
  state.distance += (state.targetDistance - state.distance) * damp(settings.smoothing * 0.6, dt);
}

/** 注視点からカメラ位置へのオフセット。長さは distance に等しい。 */
export function orbitOffset(yaw: number, pitch: number, distance: number): Vec3 {
  const horizontal = Math.cos(pitch) * distance;
  return {
    x: -Math.sin(yaw) * horizontal,
    y: Math.sin(pitch) * distance,
    z: -Math.cos(yaw) * horizontal,
  };
}
