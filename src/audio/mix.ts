import { clamp, smoothstep } from '../core/math';
import type { Chapter } from '../story/types';
import { BRIDGE, WATERWAY } from '../world/layout';

/**
 * 音の出し分け（どこで・いつ・何をどのくらいの大きさで鳴らすか）。Web Audio に依存しない純粋関数。
 * 実際の音作りは AudioEngine が行う。
 *
 * 方針：長く聞いても疲れない控えめな音。会話や画面を開いている間は、環境音と音楽を下げる。
 */

export interface AmbientMix {
  /** 風（屋外の土台の音）。 */
  readonly wind: number;
  /** 水路のせせらぎ（水路に近いほど大きい）。 */
  readonly water: number;
  /** 囲炉裏の火（室内）。 */
  readonly fire: number;
  /** 鳥の声の頻度（0〜1）。 */
  readonly birds: number;
}

export function ambientMix(p: { readonly x: number; readonly z: number; readonly indoor: boolean }): AmbientMix {
  if (p.indoor) return { wind: 0.25, water: 0, fire: 0.6, birds: 0.1 };
  const fromWater = Math.abs(p.z - WATERWAY.centerZ) - WATERWAY.halfWidth;
  const water = 1 - smoothstep(0, 16, fromWater);
  return { wind: 0.55, water: 0.75 * water, fire: 0, birds: 0.6 };
}

/** 会話・画面を開いている間の、環境音と音楽の下げ幅（1＝そのまま）。 */
export function duckFactor(mode: 'explore' | 'dialogue' | 'overlay' | 'title' | 'transition'): { ambient: number; music: number } {
  switch (mode) {
    case 'dialogue':
      return { ambient: 0.55, music: 0.4 };
    case 'overlay':
      return { ambient: 0.6, music: 0.6 };
    case 'transition':
      return { ambient: 0.3, music: 0.5 };
    default:
      return { ambient: 1, music: 1 };
  }
}

export type Surface = 'dirt' | 'wood' | 'bridge';

/** 足音の種類（室内の板の間・橋の板・土の道）。 */
export function footstepSurface(p: { readonly x: number; readonly z: number; readonly indoor: boolean }): Surface {
  if (p.indoor) return 'wood';
  if (Math.abs(p.x - BRIDGE.x) <= BRIDGE.halfWidth && p.z >= BRIDGE.startZ && p.z <= BRIDGE.endZ) return 'bridge';
  return 'dirt';
}

export type MusicMood = 'title' | 'village' | 'roofDay' | 'later' | 'ending' | 'none';

/** 章と画面から、流す音楽の雰囲気を決める。 */
export function musicMood(chapter: Chapter, screen: 'title' | 'game' | 'ending'): MusicMood {
  if (screen === 'title') return 'title';
  if (screen === 'ending' || chapter === 'end') return 'ending';
  if (chapter === 'roofDay') return 'roofDay';
  if (chapter === 'ch3') return 'later';
  return 'village';
}

/**
 * 屋根葺きの日の作業の音の大きさ（作業の場からの距離による）。
 * 人数が多いほど茅を叩く音の間隔が短くなる（人手の違いを音でも感じられるように）。
 */
export function workSound(p: {
  readonly distance: number;
  readonly roofWorkers: number;
  readonly indoor: boolean;
}): { readonly volume: number; readonly interval: number } {
  if (p.roofWorkers <= 0) return { volume: 0, interval: Infinity };
  const near = 1 - smoothstep(6, 42, p.distance);
  const volume = clamp(near * (p.indoor ? 0.35 : 1), 0, 1);
  // 1 人なら約 1.6 秒ごと、3 人なら約 0.6 秒ごと
  const interval = 1.9 / (p.roofWorkers + 0.2);
  return { volume, interval };
}
