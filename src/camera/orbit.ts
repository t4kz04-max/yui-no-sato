import { clamp, damp, dampAngle, type Vec3 } from '../core/math';

/**
 * 三人称カメラの軌道パラメータと計算。Three.js 非依存でテスト可能。
 *
 * yaw   : 水平角。カメラはプレイヤーから見て -forward(yaw) 側に位置する。
 * pitch : 見下ろし角（ラジアン）。負は見上げ（Phase 6.5）：カメラの高さは保ち、視線だけを上へ傾ける（splitPitch）。
 * distance : 注視点からの距離。
 */
export interface OrbitLimits {
  readonly minPitch: number;
  readonly maxPitch: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export const DEFAULT_ORBIT_LIMITS: OrbitLimits = {
  // 屋外は見上げられる（合掌造りの屋根の上部を見るため。Phase 6.5）
  minPitch: -0.7,
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

/** 屋内（サエ家の室内）：天井の下に収まる距離と角度。 */
export const INDOOR_ORBIT_LIMITS: OrbitLimits = {
  minPitch: 0.12,
  maxPitch: 0.9,
  minDistance: 2.2,
  maxDistance: 4.6,
};

/** 宗平の作業場の中：屋根の下に収まる、近めの距離（Phase 6.5）。 */
export const WORKSHOP_ORBIT_LIMITS: OrbitLimits = {
  minPitch: 0.06,
  maxPitch: 0.85,
  minDistance: 2.2,
  maxDistance: 5.2,
};

/**
 * 屋外の最初の構図（Phase 6）。以前（見下ろし 0.42・10m）は合掌造りの屋根が画面の上で切れやすかったため、
 * 低い視点から少し離れて見る。注視点も上げ（ThirdPersonCamera.lookHeight）、画角も少し広げる（Game）。
 * 代表的な位置（橋の南・橋の北・広場）で屋根の棟が画面に入るかを測って決めた（docs/PHASE6_PLAN.md §5.3）。
 */
export const OUTDOOR_FRAMING = { pitch: 0.16, distance: 13 } as const;
/** 室内の最初の構図。 */
export const INDOOR_FRAMING = { pitch: 0.5, distance: 3.6 } as const;

/** 視点の感度（設定の倍率）を反映した設定。 */
export function orbitSettingsFor(lookSensitivity: number): OrbitSettings {
  return { ...DEFAULT_ORBIT_SETTINGS, lookSensitivity: DEFAULT_ORBIT_SETTINGS.lookSensitivity * lookSensitivity };
}

/**
 * 壁際でカメラが遮られたとき、横へ回り込む向きを選ぶ（室内。Phase 6）。
 * candidates：今の向きからのずれ（ラジアン）と、その向きで遮られずに離せる距離。
 * 今の向きより十分に（margin 以上）離せる向きのうち、ずれが小さく離せる距離が長いものを選ぶ。なければ 0（回らない）。
 */
export function pickClearYaw(
  current: number,
  candidates: ReadonlyArray<{ readonly offset: number; readonly free: number }>,
  margin = 0.5,
): number {
  let best = 0;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.free < current + margin) continue;
    // 大きく回るほど方向感覚を失いやすいので、離せる距離からずれの大きさを差し引いて比べる
    const score = c.free - Math.abs(c.offset) * 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = c.offset;
    }
  }
  return best;
}

export function createOrbitState(yaw: number, pitch: number = OUTDOOR_FRAMING.pitch, distance: number = OUTDOOR_FRAMING.distance): OrbitState {
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

/** これより小さい上下角では、カメラの位置はこの角度のまま保ち、残りを視線の傾きにする。 */
export const LOOK_UP_START = 0.04;

/**
 * 上下角を「カメラの位置に使う角度」と「視線を上へ傾ける角度」に分ける（Phase 6.5）。
 * 見上げるときにカメラを地面へ潜らせず、主人公の後ろ・頭の高さから上を見る。
 */
export function splitPitch(pitch: number, start = LOOK_UP_START): { position: number; lookUp: number } {
  return pitch >= start ? { position: pitch, lookUp: 0 } : { position: start, lookUp: start - pitch };
}
