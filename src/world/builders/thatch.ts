import * as THREE from 'three';
import { fbm } from '../../core/noise';
import { smoothstep } from '../../core/math';
import { createRandom } from '../../core/random';

/**
 * 合掌造りの茅葺き屋根のジオメトリ（docs/PHASE5_ART.md §1）。
 *
 * - 急勾配の切妻。茅の厚み（上面・裏面・軒先の切り口・妻側の端）を持つ。
 * - 上面は細かく分割し、ゆるい膨らみと凹凸を付ける。
 * - 色は頂点色で付ける。屋根の状態（ふつう・傷み・一部だけ新しい・新しい）は頂点色の切り替えだけで表す。
 *
 * ローカル座標：棟は Z 方向、屋根の面は ±X を向く。y は家の足元からの高さ。
 * DOM・WebGL に依存しない（テストで形と色を確認できる）。
 */
export type RoofState = 'old' | 'renewed' | 'partial' | 'worn';
export const ROOF_STATES: readonly RoofState[] = ['old', 'renewed', 'partial', 'worn'];

export interface ThatchRoofSpec {
  /** 軒先（上面の外側の角）の半幅。 */
  readonly halfSpan: number;
  /** 屋根の勾配（ラジアン）。 */
  readonly pitch: number;
  /** 茅の厚み（屋根面に垂直な方向）。 */
  readonly thickness: number;
  /** 棟方向の半分の長さ（妻側の張り出しを含む）。 */
  readonly halfDepth: number;
  /** 屋根のいちばん低い所（軒先の裏側の角）の高さ。 */
  readonly eaveLow: number;
  /** 南を向いている面（+1＝+X 側、-1＝-X 側）。葺き替えはこの面に表す。 */
  readonly southSide: 1 | -1;
  /** 傷みのひどい所（南面）。z は棟方向の割合（0〜1）、uTo は軒先からの割合。 */
  readonly damage: { readonly zFrom: number; readonly zTo: number; readonly uTo: number } | null;
  readonly seed: number;
}

export interface ThatchRoof {
  /** グループ 0：上面（茅の繊維）、グループ 1：切り口と裏面。 */
  readonly geometry: THREE.BufferGeometry;
  readonly ridgeY: number;
  readonly innerApexY: number;
  readonly topEaveY: number;
  /** 屋根の裏側の高さ（棟からの水平距離 |x| で）。妻壁の形を決めるのに使う。 */
  underY(absX: number): number;
  /** 上面（膨らみを除く）の高さ。 */
  surfaceY(absX: number): number;
  /** 上面の点（膨らみを含む、状態は old 以外の形）。u：軒先 0〜棟 1、v：棟方向 0〜1。 */
  surfacePoint(side: 1 | -1, u: number, v: number): THREE.Vector3;
  /**
   * 屋根葺きの日の作業の進み具合（Phase 6）。南面を軒先から progress（0〜1）まで新しい茅にする。
   * full＝南面いっぱい、そうでなければ傷んだ所だけ。null で今の状態の見た目に戻す。
   */
  setWork(work: { readonly progress: number; readonly full: boolean } | null): void;
  /** 傷んで乱れた茅の房のジオメトリ（傷みがある屋根だけ。Phase 6.5）。 */
  readonly tufts: THREE.BufferGeometry | null;
  /** 房を描く物（描画側が設定する）。屋根の状態が old のときだけ表示する。 */
  tuftObject: THREE.Object3D | null;
  /** 屋根の状態に合わせて頂点色（と傷みのへこみ）を切り替える。 */
  setState(state: RoofState): void;
  readonly state: RoofState;
}

// 色（sRGB の 16 進を線形に変換して頂点色に使う）
const col = (hex: number) => new THREE.Color(hex);
const OLD_LIGHT = col(0x9c8464);
const OLD_DARK = col(0x745f42);
const MOSS = col(0x5f6a3c);
const DAMAGED = col(0x352c24);
const DAMAGED_MOSS = col(0x46502e);
const HOLE = col(0x1c1612);
/** 傷んで乱れた茅の房（Phase 6.5）。 */
const TUFT_DARK = col(0x4a3d2c);
const TUFT_LIGHT = col(0x8a7450);
const FRESH_LIGHT = col(0xf0cf82);
const FRESH_DARK = col(0xd2ac62);
const UNDERSIDE = col(0x4c3c2c);

const U_SEGMENTS = 14;

export function createThatchRoof(spec: ThatchRoofSpec): ThatchRoof {
  const { halfSpan, pitch, thickness: t, halfDepth, eaveLow, seed } = spec;
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);
  const tanP = Math.tan(pitch);
  const topEaveY = eaveLow + t * cosP;
  const rise = halfSpan * tanP;
  const ridgeY = topEaveY + rise;
  const innerEaveX = halfSpan - t * sinP;
  const underY = (absX: number) => eaveLow + (innerEaveX - absX) * tanP;
  const innerApexY = underY(0);
  const slopeLen = Math.hypot(halfSpan, rise);
  const V_SEGMENTS = Math.max(8, Math.round((halfDepth * 2) / 0.7));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices0: number[] = [];
  const indices1: number[] = [];
  /** 頂点ごとの「色の決め方」（状態ごとに色を計算し直すため）。 */
  const colorKeys: Array<{ side: 1 | -1; u: number; v: number; shade: number; under: boolean }> = [];
  /** 傷みのへこみ（old のときだけ使う）。頂点ごとの法線方向のずれ。 */
  const dip: Array<{ index: number; nx: number; ny: number; amount: number }> = [];

  const zAt = (v: number) => -halfDepth + 2 * halfDepth * v;

  const damageMask = (side: 1 | -1, u: number, v: number): number => {
    const d = spec.damage;
    if (!d || side !== spec.southSide) return 0;
    const edge = 0.05 + (fbm(u * 5, v * 7, seed + 77) - 0.5) * 0.08;
    const inZ = smoothstep(d.zFrom - edge, d.zFrom + edge, v) * (1 - smoothstep(d.zTo - edge, d.zTo + edge, v));
    const inU = 1 - smoothstep(d.uTo - 0.08, d.uTo + 0.08, u + (fbm(v * 6, u * 3, seed + 91) - 0.5) * 0.15);
    return inZ * inU;
  };

  /** 傷みの中の、深く欠けた所（0〜1）。下地の暗い色が見える。 */
  const gouge = (u: number, v: number) => smoothstep(0.56, 0.7, fbm(u * 13 + 3, v * 21, seed + 61));

  const bump = (side: 1 | -1, u: number, v: number) => {
    const z = zAt(v);
    const swell = 0.12 * Math.sin(Math.PI * u);
    const lumps = (fbm(u * 6 + (side > 0 ? 0 : 40), z * 0.45, seed) - 0.5) * 0.14 * Math.sin(Math.PI * u);
    return swell + lumps;
  };

  const topPoint = (side: 1 | -1, u: number, v: number, out = new THREE.Vector3()) => {
    const b = bump(side, u, v);
    return out.set(side * halfSpan * (1 - u) + side * sinP * b, topEaveY + rise * u + cosP * b, zAt(v));
  };

  // ── 上面（グループ 0）──
  const topIndex: Record<number, number[][]> = { 1: [], [-1]: [] };
  for (const side of [1, -1] as const) {
    const grid: number[][] = [];
    for (let i = 0; i <= U_SEGMENTS; i++) {
      const row: number[] = [];
      const u = i / U_SEGMENTS;
      for (let j = 0; j <= V_SEGMENTS; j++) {
        const v = j / V_SEGMENTS;
        const p = topPoint(side, u, v);
        const index = positions.length / 3;
        positions.push(p.x, p.y, p.z);
        uvs.push(p.z / 1.6, (u * slopeLen) / 2.2);
        colorKeys.push({ side, u, v, shade: 1, under: false });
        const m = damageMask(side, u, v) * smoothstep(0, 0.12, u);
        // 傷み：全体のへこみに加え、まだらに深く欠けた所（Phase 6.5 で深くした）
        if (m > 0.001) dip.push({ index, nx: side * sinP, ny: cosP, amount: -(0.45 + fbm(u * 8, v * 12, seed + 5) * 0.35 + gouge(u, v) * 0.45) * m });
        row.push(index);
      }
      grid.push(row);
    }
    for (let i = 0; i < U_SEGMENTS; i++) {
      for (let j = 0; j < V_SEGMENTS; j++) {
        const a = grid[i]![j]!;
        const b = grid[i + 1]![j]!;
        const c = grid[i + 1]![j + 1]!;
        const d = grid[i]![j + 1]!;
        // 外向き（+X 側は反時計回りが外を向くように）
        if (side > 0) indices0.push(a, c, b, a, d, c);
        else indices0.push(a, b, c, a, c, d);
      }
    }
    topIndex[side] = grid;
  }

  // 平らな面（切り口・裏面）を足す。頂点は面ごとに別にして、角をはっきりさせる。
  const quad = (pts: THREE.Vector3[], uv: Array<[number, number]>, keys: Array<(typeof colorKeys)[number]>) => {
    const base = positions.length / 3;
    pts.forEach((p, k) => {
      positions.push(p.x, p.y, p.z);
      uvs.push(uv[k]![0], uv[k]![1]);
      colorKeys.push(keys[k]!);
    });
    indices1.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const n = (side: 1 | -1) => new THREE.Vector3(side * sinP, cosP, 0);
  /** 上面の点に対応する裏側の点（厚みの分だけ内側。棟を越える所は裏側の頂点に寄せる）。 */
  const underPoint = (side: 1 | -1, u: number, v: number) => {
    const flat = new THREE.Vector3(side * halfSpan * (1 - u), topEaveY + rise * u, zAt(v));
    const q = flat.addScaledVector(n(side), -t);
    if (side * q.x < 0) q.set(0, innerApexY, zAt(v));
    return q;
  };

  for (const side of [1, -1] as const) {
    // 軒先の切り口
    for (let j = 0; j < V_SEGMENTS; j++) {
      const v0 = j / V_SEGMENTS;
      const v1 = (j + 1) / V_SEGMENTS;
      const top0 = topPoint(side, 0, v0);
      const top1 = topPoint(side, 0, v1);
      const bot0 = underPoint(side, 0, v0);
      const bot1 = underPoint(side, 0, v1);
      const pts = side > 0 ? [bot0, bot1, top1, top0] : [bot1, bot0, top0, top1];
      const vs = side > 0 ? [v0, v1, v1, v0] : [v1, v0, v0, v1];
      quad(
        pts,
        pts.map((p, k) => [p.z / 0.9, k === 0 || k === 1 ? 0 : t / 0.9]),
        vs.map((v) => ({ side, u: 0, v, shade: 0.82, under: false })),
      );
    }
    // 妻側の端（棟方向の両端）
    for (const end of [0, 1] as const) {
      for (let i = 0; i < U_SEGMENTS; i++) {
        const u0 = i / U_SEGMENTS;
        const u1 = (i + 1) / U_SEGMENTS;
        const top0 = topPoint(side, u0, end);
        const top1 = topPoint(side, u1, end);
        const bot0 = underPoint(side, u0, end);
        const bot1 = underPoint(side, u1, end);
        const forward = (side > 0) === (end === 1);
        const pts = forward ? [bot0, bot1, top1, top0] : [bot1, bot0, top0, top1];
        const us = forward ? [u0, u1, u1, u0] : [u1, u0, u0, u1];
        quad(
          pts,
          us.map((u, k) => [(u * slopeLen) / 0.9, k === 0 || k === 1 ? 0 : t / 0.9]),
          us.map((u) => ({ side, u, v: end, shade: 0.72, under: false })),
        );
      }
    }
    // 裏面
    const a = underPoint(side, 0, 0);
    const b = underPoint(side, 0, 1);
    const c = new THREE.Vector3(0, innerApexY, halfDepth);
    const d = new THREE.Vector3(0, innerApexY, -halfDepth);
    const pts = side > 0 ? [a, d, c, b] : [a, b, c, d];
    quad(
      pts,
      pts.map((p) => [p.z, p.y]),
      pts.map(() => ({ side, u: 0, v: 0, shade: 1, under: true })),
    );
  }

  const geometry = new THREE.BufferGeometry();
  const basePositions = new Float32Array(positions);
  const positionAttr = new THREE.BufferAttribute(new Float32Array(positions), 3);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const colorAttr = new THREE.BufferAttribute(new Float32Array(colorKeys.length * 3), 3);
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex([...indices0, ...indices1]);
  geometry.addGroup(0, indices0.length, 0);
  geometry.addGroup(indices0.length, indices1.length, 1);

  // ── 状態ごとの色 ──
  const tmp = new THREE.Color();
  const weathered = (side: 1 | -1, u: number, v: number, out: THREE.Color, darker: number, mossAmount: number) => {
    const z = zAt(v);
    const streak = fbm(u * 1.6 + (side > 0 ? 0 : 20), z * 1.3, seed + 3);
    out.copy(OLD_LIGHT).lerp(OLD_DARK, smoothstep(0.25, 0.75, streak));
    const band = 0.5 + 0.5 * Math.sin(u * slopeLen * 4.1 + streak * 2);
    out.multiplyScalar((1 - 0.06 * band) * darker);
    const mossNoise = fbm(u * 3 + 7, z * 0.35 + 3, seed + 5);
    const nearEave = 0.55 + 0.45 * (1 - u);
    const m = smoothstep(0.5, 0.75, mossNoise) * mossAmount * nearEave;
    return out.lerp(MOSS, Math.min(0.85, m));
  };
  const fresh = (u: number, v: number, out: THREE.Color) => {
    const z = zAt(v);
    const n1 = fbm(u * 2.2, z * 0.9, seed + 11);
    out.copy(FRESH_LIGHT).lerp(FRESH_DARK, smoothstep(0.3, 0.7, n1));
    const band = 0.5 + 0.5 * Math.sin(u * slopeLen * 4.1);
    return out.multiplyScalar(1 - 0.04 * band);
  };

  const computeColors = (state: RoofState, work: { readonly progress: number; readonly full: boolean } | null = null): Float32Array => {
    const arr = new Float32Array(colorKeys.length * 3);
    colorKeys.forEach((k, i) => {
      if (k.under) {
        tmp.copy(UNDERSIDE);
      } else {
        const south = k.side === spec.southSide;
        const dmg = damageMask(k.side, k.u, k.v);
        const mossBase = south ? 0.2 : 0.5;
        const damaged = (out: THREE.Color, amount: number) => {
          // 傷んだ所：黒ずんだ茅と、苔のまだら
          const blotch = smoothstep(0.45, 0.65, fbm(k.u * 9, k.v * 14, seed + 31));
          out.lerp(DAMAGED.clone().lerp(DAMAGED_MOSS, blotch), amount);
          // 深く欠けた所は、下地の暗い色
          return out.lerp(HOLE, gouge(k.u, k.v) * amount * 0.85);
        };
        if (state === 'worn') {
          weathered(k.side, k.u, k.v, tmp, 0.72, mossBase + 0.45);
          if (dmg > 0) damaged(tmp, dmg * 0.9);
        } else if (state === 'renewed' && south) {
          fresh(k.u, k.v, tmp);
        } else if (state === 'partial' && south) {
          const region = spec.damage ? dmg : 1 - smoothstep(0.4, 0.5, k.u);
          weathered(k.side, k.u, k.v, tmp, 1, mossBase);
          const f = fresh(k.u, k.v, new THREE.Color());
          tmp.lerp(f, smoothstep(0.35, 0.65, region));
        } else {
          weathered(k.side, k.u, k.v, tmp, 1, mossBase);
          if (state === 'old' && dmg > 0) damaged(tmp, dmg * 0.95);
          if (work && south) {
            // 葺き進んだ所（軒先から progress まで）を新しい茅にする
            const region = work.full ? 1 : spec.damage ? smoothstep(0.35, 0.65, dmg) : 1 - smoothstep(0.4, 0.5, k.u);
            const front = 1 - smoothstep(work.progress - 0.03, work.progress + 0.03, k.u);
            if (region * front > 0) tmp.lerp(fresh(k.u, k.v, new THREE.Color()), region * front);
          }
        }
        tmp.multiplyScalar(k.shade);
      }
      arr[i * 3] = tmp.r;
      arr[i * 3 + 1] = tmp.g;
      arr[i * 3 + 2] = tmp.b;
    });
    return arr;
  };
  const colorsByState = new Map<RoofState, Float32Array>();
  const damagedPositions = new Float32Array(basePositions);
  for (const d of dip) {
    damagedPositions[d.index * 3] = damagedPositions[d.index * 3]! + d.nx * d.amount;
    damagedPositions[d.index * 3 + 1] = damagedPositions[d.index * 3 + 1]! + d.ny * d.amount;
  }

  // ── 傷んで乱れた茅の房（Phase 6.5）：傷みの範囲だけに、茅が浮き上がって飛び出した細い房を置く ──
  const tufts = spec.damage ? createTufts() : null;
  function createTufts(): THREE.BufferGeometry {
    const rand = createRandom(seed * 131 + 7);
    const pos: number[] = [];
    const cols: number[] = [];
    const side = spec.southSide;
    const normal = new THREE.Vector3(side * sinP, cosP, 0);
    const down = new THREE.Vector3(side * cosP, -sinP, 0);
    const across = new THREE.Vector3(0, 0, 1);
    const base = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const wide = new THREE.Vector3();
    let placed = 0;
    for (let n = 0; n < 2600 && placed < 170; n++) {
      const u = 0.04 + rand() * 0.7;
      const v = rand();
      const m = damageMask(side, u, v);
      if (m < 0.4 || rand() > m) continue;
      placed++;
      topPoint(side, u, v, base);
      // へこみの分だけ沈めてから、少し浮かせる
      base.addScaledVector(normal, -(0.45 + fbm(u * 8, v * 12, seed + 5) * 0.35) * m + 0.08);
      const blades = 3 + Math.floor(rand() * 3);
      for (let b = 0; b < blades; b++) {
        const len = 0.35 + rand() * 0.55;
        dir
          .copy(normal)
          .multiplyScalar(0.55 + rand() * 0.35)
          .addScaledVector(down, 0.35 + rand() * 0.6)
          .addScaledVector(across, (rand() - 0.5) * 0.9)
          .normalize();
        wide.crossVectors(dir, normal).normalize().multiplyScalar(0.03 + rand() * 0.02);
        const root = base.clone().addScaledVector(across, (rand() - 0.5) * 0.25);
        const tip = root.clone().addScaledVector(dir, len);
        const a = root.clone().add(wide);
        const c = root.clone().sub(wide);
        pos.push(a.x, a.y, a.z, c.x, c.y, c.z, tip.x, tip.y, tip.z);
        const shade = 0.75 + rand() * 0.35;
        const dark = TUFT_DARK.clone().multiplyScalar(shade);
        const light = TUFT_LIGHT.clone().lerp(TUFT_DARK, rand() * 0.6).multiplyScalar(shade);
        cols.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, light.r, light.g, light.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  }

  let current: RoofState = 'old';
  /** 作業の進み具合の見た目（空なら今の状態の見た目）。 */
  let workKey = '';
  const workColors = new Map<string, Float32Array>();
  const roof: ThatchRoof = {
    geometry,
    ridgeY,
    innerApexY,
    topEaveY,
    underY,
    surfaceY: (absX) => topEaveY + (halfSpan - absX) * tanP,
    surfacePoint: (side, u, v) => topPoint(side, u, v),
    tufts,
    tuftObject: null,
    get state() {
      return current;
    },
    setState(state) {
      let colors = colorsByState.get(state);
      if (!colors) {
        colors = computeColors(state);
        colorsByState.set(state, colors);
      }
      (colorAttr.array as Float32Array).set(colors);
      colorAttr.needsUpdate = true;
      (positionAttr.array as Float32Array).set(state === 'old' && spec.damage ? damagedPositions : basePositions);
      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      current = state;
      if (roof.tuftObject) roof.tuftObject.visible = state === 'old';
      workKey = '';
    },
    setWork(work) {
      const key = work ? `${Math.round(work.progress * 20) / 20}:${work.full}` : '';
      if (key === workKey) return;
      workKey = key;
      // 進み具合は 0.05 刻みで計算して取っておく（作業中に少しずつ進めても毎回計算しない）
      let colors = work ? workColors.get(key) : colorsByState.get(current);
      if (!colors) {
        colors = work ? computeColors('old', { progress: Math.round(work.progress * 20) / 20, full: work.full }) : computeColors(current);
        if (work) workColors.set(key, colors);
        else colorsByState.set(current, colors);
      }
      (colorAttr.array as Float32Array).set(colors);
      colorAttr.needsUpdate = true;
    },
  };
  roof.setState('old');
  return roof;
}
