import { wrapAngle } from '../core/math';
import type { Interactable } from './types';

/** プレイヤーの位置と向き（heading は rotation.y。0 で +Z を向く）。 */
export interface Pose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface TargetingOptions {
  /** 正面からこの角度（ラジアン）以内にある対象だけを選ぶ。 */
  readonly maxAngle: number;
  /** この距離以内なら向きに関係なく選べる（すぐ横にいる相手に話しかけられないのを防ぐ）。 */
  readonly closeRange: number;
  /** 直前の対象を優先する余裕。候補が並んでいるときに表示がちらつかないようにする。 */
  readonly stickiness: number;
}

export const DEFAULT_TARGETING: TargetingOptions = {
  maxAngle: (80 * Math.PI) / 180,
  closeRange: 1.3,
  stickiness: 0.15,
};

/** 対象の方向と、プレイヤーの正面との角度差（0〜π）。 */
export function angleTo(pose: Pose, x: number, z: number): number {
  return Math.abs(wrapAngle(Math.atan2(x - pose.x, z - pose.z) - pose.heading));
}

function score(pose: Pose, t: Interactable, options: TargetingOptions): number | null {
  const dist = Math.hypot(t.position.x - pose.x, t.position.z - pose.z);
  if (dist > t.range) return null;
  const angle = angleTo(pose, t.position.x, t.position.z);
  if (angle > options.maxAngle && dist > options.closeRange) return null;
  // 近く、正面にあるものほど小さい（良い）値
  return dist / t.range + (0.6 * angle) / Math.PI;
}

/**
 * 操作できる対象のうち最も適したものを選ぶ。なければ null。
 * 直前の対象（previousId）がまだ操作できる範囲にあれば、僅差なら維持する。
 */
export function findTarget(
  pose: Pose,
  candidates: readonly Interactable[],
  previousId: string | null = null,
  options: TargetingOptions = DEFAULT_TARGETING,
): Interactable | null {
  let best: Interactable | null = null;
  let bestScore = Infinity;
  let previous: Interactable | null = null;
  let previousScore = Infinity;
  for (const t of candidates) {
    const s = score(pose, t, options);
    if (s === null) continue;
    if (s < bestScore) {
      best = t;
      bestScore = s;
    }
    if (t.id === previousId) {
      previous = t;
      previousScore = s;
    }
  }
  if (previous && previousScore <= bestScore + options.stickiness) return previous;
  return best;
}
