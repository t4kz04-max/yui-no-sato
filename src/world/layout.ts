import type { Bounds } from '../core/collision';
import type { Vec2 } from '../core/math';
import { createRandom } from '../core/random';

/**
 * 村の配置データ。描画・当たり判定の両方がこのデータから生成される。
 *
 * 座標系：北 = -Z、南 = +Z、東 = +X、西 = -X（単位はメートル相当）。
 * 配置は docs/GAME_DESIGN.md「E. 3Dマップ」に準拠した仮配置。
 */

/** 物語上の主要地点。Phase 1 以降のインタラクション・目的表示で参照する。 */
export type LocationId = 'saeHouse' | 'isukeHouse' | 'soheiWorkshop' | 'mineHouse' | 'southPlaza';

export interface LocationDef {
  readonly id: LocationId;
  readonly label: string;
  readonly position: Vec2;
}

export type BuildingKind = 'gassho' | 'workshop' | 'kayaShed' | 'toolShed';

/** 合掌造りの家ごとの違い（docs/PHASE5_ART.md §1）。南を向く屋根の面は rotation から決まる。 */
export interface GasshoVariant {
  /** 妻面の窓の段数。 */
  readonly windowRows: 2 | 3 | 4;
  /** 入口：妻側か、南を向いた長い辺か。 */
  readonly entrance: 'gable' | 'side';
  readonly engawa?: boolean;
  /** 壁に立てかけた茅の束。 */
  readonly leanKaya?: boolean;
  /** 南面の傷みのひどい所（棟方向の割合 zFrom〜zTo、軒先からの割合 uTo）。 */
  readonly damage?: { readonly zFrom: number; readonly zTo: number; readonly uTo: number };
  /** 中に入れる家（Phase 5.5：サエ家だけ。室内は world/saeInterior.ts）。 */
  readonly hollow?: boolean;
}

export interface BuildingDef {
  readonly id: string;
  readonly kind: BuildingKind;
  readonly position: Vec2;
  /** Three.js の rotation.y。0 のとき正面（玄関）が +Z（南）を向く。 */
  readonly rotation: number;
  readonly scale: number;
  readonly location?: LocationId;
  readonly variant?: GasshoVariant;
}

export type TreeKind = 'cedar' | 'maple' | 'broadleaf';

export interface TreeDef {
  readonly kind: TreeKind;
  readonly position: Vec2;
  readonly scale: number;
}

export type PropKind =
  | 'woodpile'
  | 'lantern'
  | 'kayaBundles'
  | 'hasaRack'
  | 'workbench'
  | 'rock'
  | 'ledgerBox'
  | 'recordShelf'
  | 'tub'
  | 'basket'
  | 'toolRack'
  | 'ladderRack'
  | 'ropeCoil';

export interface PropDef {
  readonly kind: PropKind;
  readonly position: Vec2;
  readonly rotation: number;
  readonly scale?: number;
  /** 'isukeHarvest'：伊助家のはさ掛け（刈り入れが済むと稲が増える）。 */
  readonly tag?: string;
}

export interface FieldDef {
  readonly position: Vec2;
  readonly halfWidth: number;
  readonly halfDepth: number;
}

export interface WaterwayDef {
  /** 水路の中心線（東西方向に流れる）。 */
  readonly centerZ: number;
  readonly halfWidth: number;
  readonly minX: number;
  readonly maxX: number;
  readonly waterLevel: number;
}

export interface BridgeDef {
  readonly x: number;
  /** 歩ける幅の半分。 */
  readonly halfWidth: number;
  readonly startZ: number;
  readonly endZ: number;
  readonly baseHeight: number;
  readonly archHeight: number;
}

export interface PathDef {
  readonly points: readonly Vec2[];
  readonly width: number;
}

/** 建物の足元（当たり判定）の半径。描画側もこの値で寸法を決める。 */
export const BUILDING_FOOTPRINT: Record<BuildingKind, { halfWidth: number; halfDepth: number }> = {
  gassho: { halfWidth: 5.5, halfDepth: 7.5 },
  workshop: { halfWidth: 4.2, halfDepth: 3.2 },
  kayaShed: { halfWidth: 3.2, halfDepth: 2.2 },
  toolShed: { halfWidth: 2.2, halfDepth: 1.6 },
};

export const PROP_FOOTPRINT: Record<PropKind, { halfWidth: number; halfDepth: number } | { radius: number } | null> = {
  woodpile: { halfWidth: 1.3, halfDepth: 0.5 },
  lantern: { radius: 0.5 },
  kayaBundles: { halfWidth: 1.6, halfDepth: 0.9 },
  hasaRack: { halfWidth: 3.2, halfDepth: 0.35 },
  workbench: { halfWidth: 1.3, halfDepth: 0.7 },
  rock: { radius: 0.7 },
  ledgerBox: { halfWidth: 0.45, halfDepth: 0.3 },
  recordShelf: { halfWidth: 0.55, halfDepth: 0.25 },
  tub: { radius: 0.45 },
  basket: { radius: 0.35 },
  toolRack: { halfWidth: 0.9, halfDepth: 0.3 },
  ladderRack: { halfWidth: 1.6, halfDepth: 0.35 },
  ropeCoil: { radius: 0.4 },
};

export const TREE_TRUNK_RADIUS = 0.55;

export const LOCATIONS: readonly LocationDef[] = [
  { id: 'saeHouse', label: 'サエ家', position: { x: 0, z: 0 } },
  { id: 'isukeHouse', label: '伊助家と畑', position: { x: 24, z: -6 } },
  { id: 'soheiWorkshop', label: '宗平の作業場', position: { x: 0, z: -27 } },
  { id: 'mineHouse', label: 'ミネ家と茅置場', position: { x: -24, z: -6 } },
  { id: 'southPlaza', label: '橋・水路・広場', position: { x: 0, z: 16 } },
];

export const BUILDINGS: readonly BuildingDef[] = [
  // 中央：屋根葺き予定の大きな合掌造り（ランドマーク）。
  // 棟を東西に通し、屋根の南面が広場を向く（物語の「南面を葺き替える」と見た目を合わせる。Phase 5）。
  // 入口は南の長い辺。傷みのひどい所は南面の西側（「サエ家の屋根」を調べる場所の上）。
  {
    id: 'sae',
    kind: 'gassho',
    position: { x: 0, z: 0 },
    rotation: Math.PI / 2,
    scale: 1.2,
    location: 'saeHouse',
    variant: { windowRows: 4, entrance: 'side', engawa: true, damage: { zFrom: 0.14, zTo: 0.46, uTo: 0.62 }, hollow: true },
  },
  // 東：伊助家（正面を村の中心＝西へ向ける）
  {
    id: 'isuke',
    kind: 'gassho',
    position: { x: 24, z: -6 },
    rotation: -Math.PI / 2,
    scale: 1.0,
    location: 'isukeHouse',
    variant: { windowRows: 3, entrance: 'gable' },
  },
  { id: 'isukeShed', kind: 'toolShed', position: { x: 29.5, z: -15.2 }, rotation: Math.PI, scale: 1.0, location: 'isukeHouse' },
  // 西：ミネ家（正面を東へ向ける）
  {
    id: 'mine',
    kind: 'gassho',
    position: { x: -24, z: -6 },
    rotation: Math.PI / 2,
    scale: 1.0,
    location: 'mineHouse',
    variant: { windowRows: 3, entrance: 'gable', leanKaya: true },
  },
  { id: 'mineKayaShed', kind: 'kayaShed', position: { x: -25, z: 10 }, rotation: Math.PI / 2, scale: 1.0, location: 'mineHouse' },
  // 北：宗平の作業場
  { id: 'sohei', kind: 'workshop', position: { x: 0, z: -27 }, rotation: 0, scale: 1.0, location: 'soheiWorkshop' },
  // 背景の家々（村の広がり）。南の 2 軒は歩ける範囲の外（水路の南の田んぼの向こう）
  { id: 'bgNorthWest', kind: 'gassho', position: { x: -25, z: -33 }, rotation: 0.3, scale: 0.9, variant: { windowRows: 3, entrance: 'gable' } },
  { id: 'bgNorthEast', kind: 'gassho', position: { x: 25, z: -33 }, rotation: -0.25, scale: 0.95, variant: { windowRows: 3, entrance: 'gable' } },
  { id: 'bgSouthWest', kind: 'gassho', position: { x: -31, z: 47.5 }, rotation: Math.PI * 0.94, scale: 0.8, variant: { windowRows: 2, entrance: 'gable' } },
  { id: 'bgSouthEast', kind: 'gassho', position: { x: 33, z: 48 }, rotation: -Math.PI * 0.92, scale: 0.85, variant: { windowRows: 3, entrance: 'gable' } },
];

export const FIELD: FieldDef = { position: { x: 40, z: -4 }, halfWidth: 5.5, halfDepth: 10 };

/** 水路の南の田んぼ（刈り取りの済んだ田。見た目だけで、歩いて入れる）。 */
export const PADDIES: readonly FieldDef[] = [
  { position: { x: 9.2, z: 31.6 }, halfWidth: 5.0, halfDepth: 4.4 },
  { position: { x: 20.2, z: 31.4 }, halfWidth: 5.2, halfDepth: 4.6 },
  { position: { x: -9.6, z: 31.6 }, halfWidth: 5.4, halfDepth: 4.4 },
  { position: { x: -21.4, z: 31.8 }, halfWidth: 5.2, halfDepth: 4.6 },
];

export const WATERWAY: WaterwayDef = { centerZ: 23, halfWidth: 2.1, minX: -70, maxX: 70, waterLevel: -0.45 };

export const BRIDGE: BridgeDef = { x: 0, halfWidth: 1.4, startZ: 19.8, endZ: 26.2, baseHeight: 0.12, archHeight: 0.35 };

export const PATHS: readonly PathDef[] = [
  // 南の入口 → 橋
  { points: [{ x: 0, z: 40 }, { x: 0, z: 26 }], width: 3 },
  // 橋 → 広場 → サエ家の入口（南の長い辺）
  { points: [{ x: 0, z: 20 }, { x: 0, z: 7.8 }], width: 3.2 },
  // 広場 → 東（伊助家）
  { points: [{ x: 2, z: 15 }, { x: 10, z: 12 }, { x: 13.5, z: 4 }, { x: 15.5, z: -6 }], width: 2.4 },
  // 広場 → 西（ミネ家・茅置場）
  { points: [{ x: -2, z: 15 }, { x: -10, z: 12 }, { x: -13.5, z: 4 }, { x: -15.5, z: -6 }], width: 2.4 },
  { points: [{ x: -13, z: 9 }, { x: -20, z: 10 }], width: 1.8 },
  // 西の道 → 北（宗平の作業場）
  { points: [{ x: -13.5, z: -2 }, { x: -11, z: -14 }, { x: -5, z: -20 }, { x: 0, z: -22 }], width: 2.2 },
  // 東の道 → 北
  { points: [{ x: 13.5, z: -2 }, { x: 11, z: -14 }, { x: 5, z: -20 }, { x: 0, z: -22 }], width: 2.2 },
  // 伊助家 → 畑
  { points: [{ x: 32, z: 4 }, { x: 34, z: 4 }], width: 1.6 },
];

export const PROPS: readonly PropDef[] = [
  // 広場の石灯籠
  { kind: 'lantern', position: { x: 3.4, z: 13 }, rotation: 0 },
  { kind: 'lantern', position: { x: -3.4, z: 13 }, rotation: 0 },
  // 軒下の薪（サエ家は北側の軒下）
  { kind: 'woodpile', position: { x: -4.5, z: -7.45 }, rotation: 0 },
  { kind: 'woodpile', position: { x: 3.5, z: -7.45 }, rotation: 0 },
  { kind: 'woodpile', position: { x: 26, z: 3.2 }, rotation: 0 },
  { kind: 'woodpile', position: { x: -26, z: -15.2 }, rotation: 0 },
  // 伊助家の畑：はさ掛け（収穫期の忙しさを環境で示す）
  { kind: 'hasaRack', position: { x: 40, z: 8.6 }, rotation: 0, tag: 'isukeHarvest' },
  { kind: 'hasaRack', position: { x: 40, z: -16.6 }, rotation: 0, scale: 0.8, tag: 'isukeHarvest' },
  // 水路の南の田んぼのはさ掛け
  { kind: 'hasaRack', position: { x: 9.2, z: 34.6 }, rotation: 0, scale: 0.9 },
  { kind: 'hasaRack', position: { x: -21.4, z: 34.8 }, rotation: 0, scale: 0.9 },
  // ミネ家の茅置場：束ねた茅
  { kind: 'kayaBundles', position: { x: -20.5, z: 14.5 }, rotation: 0 },
  { kind: 'kayaBundles', position: { x: -29.5, z: 14.5 }, rotation: 0 },
  // 宗平の作業場：作業台（Phase 1 以降の計画台の仮置き）
  { kind: 'workbench', position: { x: 4.5, z: -21 }, rotation: 0 },
  // サエ家の結帳の文箱は、Phase 5.5 で室内（world/saeInterior.ts）へ移した
  // ミネ家の茅置場の脇の棚（貸し借りの控え）
  { kind: 'recordShelf', position: { x: -22.15, z: 8.5 }, rotation: Math.PI / 2 },
  // 水路沿いの石
  { kind: 'rock', position: { x: 6, z: 19.4 }, rotation: 0.4 },
  { kind: 'rock', position: { x: -8, z: 19.6 }, rotation: 1.1, scale: 0.8 },
  { kind: 'rock', position: { x: 14, z: 26.4 }, rotation: 2.2, scale: 1.1 },
  // 暮らしの道具（壁際・道から離れた所に置く）
  { kind: 'tub', position: { x: -7.6, z: 7.6 }, rotation: 0 },
  { kind: 'basket', position: { x: 8.9, z: 7.3 }, rotation: 0.4 },
  { kind: 'toolRack', position: { x: 26.8, z: -12.4 }, rotation: 0 },
  { kind: 'basket', position: { x: 32.6, z: -1.2 }, rotation: 1.2 },
  { kind: 'tub', position: { x: 17.6, z: -12.4 }, rotation: 0 },
  { kind: 'tub', position: { x: -17.4, z: -12.6 }, rotation: 0 },
  { kind: 'basket', position: { x: -30.6, z: 1.0 }, rotation: 2.1 },
  // 宗平の作業場：梯子・縄（屋根葺きの道具）
  { kind: 'ladderRack', position: { x: -2.6, z: -31.0 }, rotation: Math.PI },
  { kind: 'ropeCoil', position: { x: 6.2, z: -24.6 }, rotation: 0 },
  { kind: 'toolRack', position: { x: -5.6, z: -27 }, rotation: Math.PI / 2 },
];

export const PLAYER_START = { position: { x: 0, z: 31 }, yaw: Math.PI } as const;

/** プレイヤーが歩ける範囲。外側は山すその地形と木々で自然に閉じる。 */
export const WALK_BOUNDS: Bounds = { minX: -50, maxX: 50, minZ: -47, maxZ: 40 };

/** 木の配置。村の中の数本は手置き、外周はシード付き乱数で生成する。 */
export const TREES: readonly TreeDef[] = buildTrees();

function buildTrees(): TreeDef[] {
  const trees: TreeDef[] = [
    { kind: 'maple', position: { x: 9, z: 18 }, scale: 1.0 },
    { kind: 'maple', position: { x: -11, z: 18.5 }, scale: 0.9 },
    { kind: 'broadleaf', position: { x: 14, z: -18 }, scale: 1.1 },
    { kind: 'cedar', position: { x: -14, z: -22 }, scale: 1.0 },
    { kind: 'maple', position: { x: 10, z: -27 }, scale: 0.9 },
    { kind: 'cedar', position: { x: -34, z: 2 }, scale: 1.2 },
    { kind: 'broadleaf', position: { x: 33, z: 15 }, scale: 1.0 },
    { kind: 'maple', position: { x: -16.2, z: 38.6 }, scale: 1.1 },
    { kind: 'cedar', position: { x: 28.4, z: 37.6 }, scale: 1.0 },
  ];

  const rand = createRandom(20261114);
  const kinds: TreeKind[] = ['cedar', 'cedar', 'broadleaf', 'maple'];
  // 外周（歩行範囲の縁から外側）に森を作る
  for (let i = 0; i < 90; i++) {
    const angle = rand() * Math.PI * 2;
    const r = 1.0 + rand() * 0.45;
    const x = Math.cos(angle) * 52 * r;
    const z = Math.sin(angle) * 47 * r - 3;
    const kindRoll = rand();
    const scaleRoll = rand();
    if (isReservedForTree(x, z)) continue;
    trees.push({
      kind: kinds[Math.floor(kindRoll * kinds.length)] ?? 'cedar',
      position: { x, z },
      scale: 0.9 + scaleRoll * 0.6,
    });
  }
  return trees;
}

/** 建物・畑・水路・道の上には外周の木を生やさない。 */
function isReservedForTree(x: number, z: number): boolean {
  if (Math.abs(z - WATERWAY.centerZ) < WATERWAY.halfWidth + 2.5) return true;
  for (const f of [FIELD, ...PADDIES]) {
    if (Math.abs(x - f.position.x) < f.halfWidth + 3 && Math.abs(z - f.position.z) < f.halfDepth + 3) return true;
  }
  for (const b of BUILDINGS) {
    const fp = BUILDING_FOOTPRINT[b.kind];
    const reach = Math.hypot(fp.halfWidth, fp.halfDepth) * b.scale + 3;
    if (Math.hypot(x - b.position.x, z - b.position.z) < reach) return true;
  }
  for (const path of PATHS) {
    for (let i = 0; i + 1 < path.points.length; i++) {
      const a = path.points[i];
      const c = path.points[i + 1];
      if (a && c && distanceToSegment(x, z, a, c) < path.width / 2 + 2.5) return true;
    }
  }
  return false;
}

export function distanceToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lenSq));
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
}

/** 遠景の山並み（描画のみ）。手前から奥へ、輪郭の違う尾根を重ねる。 */
export interface MountainRangeDef {
  /** 村の中心からの距離。 */
  readonly distance: number;
  /** 尾根の高さの基準と揺らぎ。 */
  readonly height: number;
  readonly variation: number;
  /** 空の色に近づける割合（遠いほど大きい）。 */
  readonly haze: number;
  readonly seed: number;
}

export const MOUNTAIN_RANGES: readonly MountainRangeDef[] = [
  { distance: 160, height: 30, variation: 20, haze: 0.12, seed: 3 },
  { distance: 230, height: 55, variation: 32, haze: 0.3, seed: 7 },
  { distance: 310, height: 90, variation: 44, haze: 0.5, seed: 11 },
];
