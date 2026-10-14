import type { Vec2 } from '../core/math';
import type { LocationDef, LocationId } from './layout';

/** この距離より離れていると、どの地点にもいないとみなす。 */
export const AREA_MAX_DISTANCE = 16;
/** 境目で地点の判定が行き来しないための余裕（m）。 */
export const AREA_HYSTERESIS = 3;

/**
 * プレイヤーが今いる地点を決める（地点に入ったときのイベント発火に使う）。
 * 最も近い地点を選ぶが、今いる地点より十分に近くならない限り切り替えない。
 */
export function resolveArea(
  current: LocationId | null,
  pos: Vec2,
  locations: readonly LocationDef[],
  maxDistance = AREA_MAX_DISTANCE,
  hysteresis = AREA_HYSTERESIS,
): LocationId | null {
  let best: LocationDef | null = null;
  let bestDist = Infinity;
  let currentDist = Infinity;
  for (const loc of locations) {
    const d = Math.hypot(loc.position.x - pos.x, loc.position.z - pos.z);
    if (d < bestDist) {
      best = loc;
      bestDist = d;
    }
    if (loc.id === current) currentDist = d;
  }
  if (current !== null && currentDist <= maxDistance + hysteresis && currentDist <= bestDist + hysteresis) {
    return current;
  }
  return best && bestDist <= maxDistance ? best.id : null;
}
