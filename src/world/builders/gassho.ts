import * as THREE from 'three';
import { createRandom } from '../../core/random';
import { BUILDING_FOOTPRINT } from '../layout';
import { boxWithWorldUv, markCameraBlocker, shadowed, type Palette } from './materials';
import { createThatchRoof, type ThatchRoof, type ThatchRoofSpec } from './thatch';

/**
 * 合掌造りの家（docs/PHASE5_ART.md §1）。
 *
 * 表現するのは、合掌造りについて広く知られている特徴だけにする：
 * 急勾配（約58°）で厚みのある茅葺きの切妻屋根、厚い軒先、妻側の張り出し、
 * 妻面の階ごとの窓、木の躯体（柱・横木・板壁）と障子、石の土台。
 * 村は架空で、特定の建物の復元ではない。
 *
 * ローカル座標：棟は Z 方向、屋根の面は ±X を向く。y は家の足元からの高さ。
 * 当たり判定は layout.ts の BUILDING_FOOTPRINT（この家の外形）で、描画は土台・壁ともその内側に収める。
 */

export interface GasshoStyle {
  /** 妻面の窓の段数（家の大きさの違い）。 */
  readonly windowRows: 2 | 3 | 4;
  /** 入口：妻側（+Z）か、南を向いた長い辺か。 */
  readonly entrance: 'gable' | 'side';
  /** 入口のある長い辺の縁側。 */
  readonly engawa: boolean;
  /** 長い辺の壁に立てかけた茅の束（茅を扱う家）。 */
  readonly leanKaya: boolean;
  /** 南を向いている屋根の面（+1＝+X 側、-1＝-X 側）。 */
  readonly southSide: 1 | -1;
  /** 傷みのひどい所（南面）。 */
  readonly damage: ThatchRoofSpec['damage'];
  readonly seed: number;
  /** 中に入れる家（壁を中空にする。外から見た形は同じ）。Phase 5.5：サエ家だけ。 */
  readonly hollow?: boolean;
}

export const DEFAULT_GASSHO_STYLE: GasshoStyle = {
  windowRows: 3,
  entrance: 'gable',
  engawa: false,
  leanKaya: false,
  southSide: 1,
  damage: null,
  seed: 1,
};

export interface GasshoHouse {
  readonly root: THREE.Group;
  readonly roof: ThatchRoof;
}

// 寸法（縮尺 1 のとき）
const PITCH = THREE.MathUtils.degToRad(58);
const THICKNESS = 0.95;
const HALF_SPAN = 6.3;
const EAVE_LOW = 4.3;
const ROOF_HALF_DEPTH = 8.3;
const BODY_HALF_W = 5;
const BODY_HALF_D = 7;
const SILL_Y = 0.6;
/** 中に入れる家の外壁の厚み（縮尺 1 のとき）。 */
const WALL_THICKNESS = 0.25;
/** 壁の上端（屋根の裏に隠れる高さ）。 */
const WALL_TOP_Y = 5.2;

export function createGasshoHouse(p: Palette, style: GasshoStyle = DEFAULT_GASSHO_STYLE): GasshoHouse {
  const house = new THREE.Group();
  house.name = 'gassho';
  const fp = BUILDING_FOOTPRINT.gassho;
  const rand = createRandom(style.seed * 7919 + 13);
  const add = <T extends THREE.Object3D>(obj: T, x = 0, y = 0, z = 0): T => {
    obj.position.set(x, y, z);
    house.add(obj);
    return obj;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, cast = true) =>
    shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), cast);

  // ── 1. 石の土台（斜面に埋まるよう地中まで伸ばす）──
  add(box(fp.halfWidth * 2 - 0.2, 1.6, fp.halfDepth * 2 - 0.2, p.stone), 0, SILL_Y - 0.8, 0);
  // 土台の上端に並ぶ石（不ぞろいな大きさで石積みらしく）
  for (const [len, axis, offset] of [
    [fp.halfDepth * 2 - 0.2, 'z', fp.halfWidth - 0.15],
    [fp.halfWidth * 2 - 0.2, 'x', fp.halfDepth - 0.15],
  ] as const) {
    for (const sign of [1, -1]) {
      let pos = -len / 2;
      while (pos < len / 2 - 0.2) {
        const size = Math.min(0.5 + rand() * 0.6, len / 2 - pos);
        const h = 0.3 + rand() * 0.18;
        const stone = box(axis === 'z' ? 0.32 : size - 0.05, h, axis === 'z' ? size - 0.05 : 0.32, p.stone, false);
        const c = pos + size / 2;
        stone.position.set(axis === 'z' ? sign * offset : c, SILL_Y - h / 2 + 0.06, axis === 'z' ? c : sign * offset);
        house.add(stone);
        pos += size;
      }
    }
  }

  // ── 2. 木の躯体（板壁）──
  const wallH = WALL_TOP_Y - SILL_Y;
  if (style.hollow) {
    // 中に入れる家：外壁を 4 枚の厚い板にする（内側の面が室内の壁になる。室内は interior.ts）
    const t = WALL_THICKNESS;
    const slabs: Array<[number, number, number, number]> = [
      [BODY_HALF_W * 2, t, 0, BODY_HALF_D - t / 2],
      [BODY_HALF_W * 2, t, 0, -BODY_HALF_D + t / 2],
      [t, BODY_HALF_D * 2 - t * 2, BODY_HALF_W - t / 2, 0],
      [t, BODY_HALF_D * 2 - t * 2, -BODY_HALF_W + t / 2, 0],
    ];
    for (const [w, d, x, z] of slabs) {
      const slab = shadowed(new THREE.Mesh(boxWithWorldUv(w, wallH, d, 1.6), p.woodWall));
      slab.position.set(x, SILL_Y + wallH / 2, z);
      slab.name = 'house-wall';
      markCameraBlocker(slab);
      house.add(slab);
    }
  } else {
    const body = shadowed(
      new THREE.Mesh(boxWithWorldUv(BODY_HALF_W * 2, wallH, BODY_HALF_D * 2, 1.6), p.woodWall),
    );
    body.position.y = SILL_Y + wallH / 2;
    markCameraBlocker(body);
    house.add(body);
  }

  const pillarH = EAVE_LOW + 0.2 - SILL_Y;
  const pillarGeo = new THREE.BoxGeometry(0.26, pillarH, 0.26);
  const pillarY = SILL_Y + pillarH / 2;
  const sidePillars: number[] = [];
  for (let z = -BODY_HALF_D; z <= BODY_HALF_D + 0.01; z += 1.75) sidePillars.push(z);
  for (const z of sidePillars) {
    for (const x of [-BODY_HALF_W - 0.05, BODY_HALF_W + 0.05]) {
      // 長い辺の入口の所には柱を立てない
      if (style.entrance === 'side' && Math.sign(x) === style.southSide && Math.abs(z) < 1.2) continue;
      const pillar = shadowed(new THREE.Mesh(pillarGeo, p.woodDark), false);
      pillar.position.set(x, pillarY, z);
      house.add(pillar);
    }
  }
  for (let x = -BODY_HALF_W + 1.25; x <= BODY_HALF_W - 1.2; x += 2.5) {
    for (const z of [-BODY_HALF_D - 0.05, BODY_HALF_D + 0.05]) {
      const pillar = shadowed(new THREE.Mesh(pillarGeo, p.woodDark), false);
      pillar.position.set(x, pillarY, z);
      house.add(pillar);
    }
  }
  // 横木（土台・鴨居・胴差し）
  for (const [y, h] of [
    [SILL_Y + 0.12, 0.24],
    [2.95, 0.2],
    [EAVE_LOW - 0.1, 0.3],
  ] as const) {
    if (style.hollow) {
      // 中に入れる家：外壁に沿った 4 本の横木にする（家の中を板でふさがない）
      const t = 0.24;
      add(box(BODY_HALF_W * 2 + t, h, t, p.woodDark, false), 0, y, BODY_HALF_D + 0.0);
      add(box(BODY_HALF_W * 2 + t, h, t, p.woodDark, false), 0, y, -BODY_HALF_D);
      add(box(t, h, BODY_HALF_D * 2 + t, p.woodDark, false), BODY_HALF_W, y, 0);
      add(box(t, h, BODY_HALF_D * 2 + t, p.woodDark, false), -BODY_HALF_W, y, 0);
    } else {
      add(box(BODY_HALF_W * 2 + 0.24, h, BODY_HALF_D * 2 + 0.24, p.woodDark, false), 0, y, 0);
    }
  }

  // 長い辺の窓：柱の間ごとに、障子か板戸（雨戸）
  // 長い辺の入口は、南を向いた側に付ける
  const doorSide = style.southSide;
  const shojiGeo = new THREE.BoxGeometry(0.08, 1.25, 1.45);
  const shutterGeo = boxWithWorldUv(0.08, 1.4, 1.5, 1.6);
  for (const side of [1, -1] as const) {
    for (let i = 0; i + 1 < sidePillars.length; i++) {
      const z = (sidePillars[i]! + sidePillars[i + 1]!) / 2;
      const isDoor = style.entrance === 'side' && side === doorSide && Math.abs(z) < 1.2;
      if (isDoor) continue;
      const shutter = rand() < 0.3;
      const pane = shadowed(new THREE.Mesh(shutter ? shutterGeo : shojiGeo, shutter ? p.woodWeathered : p.shoji), false);
      pane.position.set(side * (BODY_HALF_W + 0.04), 2.05, z);
      house.add(pane);
    }
  }

  // ── 3. 入口 ──
  const door = (x: number, z: number, rotY: number) => {
    const g = new THREE.Group();
    const frame = box(2.3, 2.6, 0.18, p.woodDark, false);
    frame.position.y = 1.3;
    g.add(frame);
    const leaf = new THREE.Mesh(boxWithWorldUv(1.0, 2.3, 0.1, 1.6), p.woodLight);
    leaf.position.set(-0.48, 1.2, 0.08);
    g.add(leaf);
    const leaf2 = new THREE.Mesh(new THREE.BoxGeometry(0.96, 2.3, 0.1), p.shoji);
    leaf2.position.set(0.5, 1.2, 0.06);
    g.add(leaf2);
    // 入口の上の小さな板屋根
    const canopy = box(2.9, 0.12, 0.9, p.woodWeathered);
    canopy.position.set(0, 2.85, 0.4);
    canopy.rotation.x = 0.25;
    g.add(canopy);
    g.position.set(x, SILL_Y, z);
    g.rotation.y = rotY;
    house.add(g);
  };
  if (style.entrance === 'gable') {
    door(0, BODY_HALF_D + 0.1, 0);
    for (const x of [-3, 3]) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.08), p.shoji);
      pane.position.set(x, 2.1, BODY_HALF_D + 0.06);
      house.add(pane);
    }
  } else {
    door(doorSide * (BODY_HALF_W + 0.1), 0, (doorSide * Math.PI) / 2);
    for (const x of [-3, 3]) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.08), p.shoji);
      pane.position.set(x, 2.1, BODY_HALF_D + 0.06);
      house.add(pane);
    }
  }
  // 裏の妻側の窓
  for (const x of [-2.5, 0, 2.5]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.08), p.shoji);
    pane.position.set(x, 2.1, -BODY_HALF_D - 0.06);
    house.add(pane);
  }

  // 縁側（入口のある長い辺。当たり判定の内側に収める）
  if (style.engawa) {
    const x = doorSide * (BODY_HALF_W + 0.28);
    for (const [z0, z1] of [
      [-6.4, -1.5],
      [1.5, 6.4],
    ] as const) {
      const deck = box(0.56, 0.12, z1 - z0, p.woodLight);
      deck.position.set(x, SILL_Y + 0.15, (z0 + z1) / 2);
      house.add(deck);
      for (const z of [z0 + 0.2, (z0 + z1) / 2, z1 - 0.2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), p.woodDark);
        leg.position.set(x + doorSide * 0.15, SILL_Y - 0.1, z);
        house.add(leg);
      }
    }
  }

  // ── 4. 茅葺き屋根 ──
  const roof = createThatchRoof({
    halfSpan: HALF_SPAN,
    pitch: PITCH,
    thickness: THICKNESS,
    halfDepth: ROOF_HALF_DEPTH,
    eaveLow: EAVE_LOW,
    southSide: style.southSide,
    damage: style.damage,
    seed: style.seed,
  });
  const roofMesh = shadowed(new THREE.Mesh(roof.geometry, [p.thatchTop, p.thatchCut]));
  roofMesh.name = 'thatch-roof';
  markCameraBlocker(roofMesh);
  house.add(roofMesh);
  // 傷んで乱れた茅の房（傷みのある屋根だけ。状態が old のときだけ見える。Phase 6.5）
  if (roof.tufts) {
    const tuftMesh = shadowed(new THREE.Mesh(roof.tufts, tuftMaterial()), false);
    tuftMesh.name = 'thatch-tufts';
    tuftMesh.userData.dynamic = true;
    roof.tuftObject = tuftMesh;
    tuftMesh.visible = roof.state === 'old';
    house.add(tuftMesh);
  }

  // 棟：茅を丸く押さえた上に、押さえの木を並べる
  const ridge = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, ROOF_HALF_DEPTH * 2 + 0.1, 10, 1).rotateX(Math.PI / 2), p.thatchEdge),
  );
  ridge.scale.set(1.15, 0.8, 1);
  add(ridge, 0, roof.ridgeY - 0.05, 0);
  const ridgeBarGeo = new THREE.BoxGeometry(1.4, 0.16, 0.16);
  for (let z = -ROOF_HALF_DEPTH + 0.6; z <= ROOF_HALF_DEPTH - 0.5; z += 1.3) {
    add(shadowed(new THREE.Mesh(ridgeBarGeo, p.woodDark), false), 0, roof.ridgeY + 0.38, z);
  }
  add(box(0.22, 0.2, ROOF_HALF_DEPTH * 2 + 0.3, p.woodDark, false), 0, roof.ridgeY + 0.5, 0);

  // ── 5. 妻面：板壁・柱と貫の格子・階ごとの窓 ──
  const gableHalfAt = (y: number) => Math.max(0, (roof.innerApexY - y) / Math.tan(PITCH));
  const gableBase = WALL_TOP_Y - 0.05;
  const gableHeight = roof.innerApexY - gableBase;
  const gableShape = new THREE.Shape();
  const baseHalf = gableHalfAt(gableBase);
  gableShape.moveTo(-baseHalf, 0);
  gableShape.lineTo(0, gableHeight);
  gableShape.lineTo(baseHalf, 0);
  gableShape.closePath();
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  // 板目が横に通るよう UV を実寸に
  const guv = gableGeo.attributes.uv as THREE.BufferAttribute;
  const gpos = gableGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, gpos.getX(i) / 1.6, gpos.getY(i) / 1.6);
  const rowYs = [6.0, 8.0, 9.9, 11.6].slice(0, style.windowRows);
  for (const side of [1, -1]) {
    const gable = shadowed(new THREE.Mesh(gableGeo, p.woodWall), false, true);
    gable.position.set(0, gableBase, side * (BODY_HALF_D + 0.02));
    if (side < 0) gable.rotation.y = Math.PI;
    house.add(gable);

    const z = side * (BODY_HALF_D + 0.1);
    // 中心の束（縦の柱）と、各階の床の高さの横木
    add(box(0.22, gableHeight - 0.2, 0.14, p.woodDark, false), 0, gableBase + (gableHeight - 0.2) / 2, z);
    for (const y of [5.25, 7.1, 9.0, 10.8, 12.3]) {
      const hw = gableHalfAt(y);
      if (hw < 0.5) continue;
      add(box(hw * 2, 0.16, 0.14, p.woodDark, false), 0, y, z);
    }
    for (const x of [-2.6, 2.6]) {
      const top = roof.innerApexY - Math.abs(x) * Math.tan(PITCH);
      if (top - gableBase < 1) continue;
      add(box(0.18, top - gableBase - 0.1, 0.14, p.woodDark, false), x, gableBase + (top - gableBase - 0.1) / 2, z);
    }
    // 窓（階ごとに、その高さの妻壁の幅に収まる数だけ）
    rowYs.forEach((y, row) => {
      const hw = gableHalfAt(y + 0.45) - 0.35;
      const count = Math.max(1, Math.min(4, Math.floor((hw * 2) / 1.25)));
      const w = row === 0 ? 1.0 : 0.85;
      for (let k = 0; k < count; k++) {
        const x = (k - (count - 1) / 2) * 1.25;
        if (Math.abs(x) < 0.25 && count % 2 === 1 && count > 1) continue;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.86, 0.1), p.woodDark);
        frame.position.set(x, y, z + side * 0.02);
        house.add(frame);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 0.08), p.shoji);
        pane.position.set(x, y, z + side * 0.06);
        house.add(pane);
      }
    });
  }

  // ── 6. 壁に立てかけた茅の束（茅を扱う家）──
  if (style.leanKaya) {
    const geo = new THREE.CylinderGeometry(0.2, 0.26, 2.6, 7);
    const side = style.southSide;
    for (let i = 0; i < 9; i++) {
      const bundle = shadowed(new THREE.Mesh(geo, i % 3 === 0 ? p.thatch : p.thatchFresh));
      bundle.position.set(side * (BODY_HALF_W + 0.25), SILL_Y + 1.25, -4.8 + i * 0.45 + rand() * 0.1);
      bundle.rotation.z = side * -0.12;
      house.add(bundle);
    }
  }

  return { root: house, roof };
}

/** 屋根の勾配と寸法（当日の足場や屋根の上の人の位置を決めるのに使う）。 */
export const GASSHO_ROOF = { pitch: PITCH, halfSpan: HALF_SPAN, thickness: THICKNESS, eaveLow: EAVE_LOW, halfDepth: ROOF_HALF_DEPTH } as const;

let sharedTuftMaterial: THREE.MeshStandardMaterial | null = null;
/** 乱れた茅の房の材質（細い面なので両面を描く）。 */
function tuftMaterial(): THREE.MeshStandardMaterial {
  sharedTuftMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  return sharedTuftMaterial;
}
