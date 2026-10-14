import * as THREE from 'three';
import { BUILDING_FOOTPRINT } from '../layout';
import { markCameraBlocker, shadowed, type Palette } from './materials';

/**
 * 合掌造りの家（仮モデル）。既存試作の構成（石垣・木造躯体・白壁・柱・障子・茅葺き屋根）を移植し、
 * 屋根を実際の合掌造りに近い急勾配（約58°）の厚みのある切妻形状に作り直した。
 *
 * ローカル座標：正面（玄関）が +Z、棟は Z 方向。
 * Phase 5 で質感・色むら・木組みの作り込みを行う前提の仮形状。
 */

const ROOF_PITCH = THREE.MathUtils.degToRad(58);
const ROOF_THICKNESS = 0.9;
const EAVE_HALF_SPAN = 6.2; // 軒先の半幅（壁より外へ張り出す）
const EAVE_Y = 4.4;
const WALL_TOP_Y = 4.8;
const BODY_HALF_W = 5;
const BODY_HALF_D = 7;
const ROOF_HALF_DEPTH = 8.3;

/** 厚みのある逆V字断面（茅葺き屋根）を Z 方向に押し出す。 */
function createRoofGeometry(): { geometry: THREE.BufferGeometry; ridgeHeight: number; innerApex: number } {
  const rise = EAVE_HALF_SPAN * Math.tan(ROOF_PITCH);
  const w = ROOF_THICKNESS / Math.sin(ROOF_PITCH);
  const h = ROOF_THICKNESS / Math.cos(ROOF_PITCH);
  const shape = new THREE.Shape();
  shape.moveTo(-EAVE_HALF_SPAN, 0);
  shape.lineTo(0, rise);
  shape.lineTo(EAVE_HALF_SPAN, 0);
  shape.lineTo(EAVE_HALF_SPAN - w, 0);
  shape.lineTo(0, rise - h);
  shape.lineTo(-EAVE_HALF_SPAN + w, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: ROOF_HALF_DEPTH * 2, bevelEnabled: false });
  geometry.translate(0, 0, -ROOF_HALF_DEPTH);
  geometry.computeVertexNormals();
  return { geometry, ridgeHeight: rise, innerApex: rise - h };
}

/** 妻壁（屋根の下の三角形の壁）。 */
function createGableGeometry(baseHalfWidth: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-baseHalfWidth, 0);
  shape.lineTo(0, height);
  shape.lineTo(baseHalfWidth, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
  geometry.translate(0, 0, -0.125);
  return geometry;
}

export function createGasshoHouse(p: Palette): THREE.Group {
  const house = new THREE.Group();
  house.name = 'gassho';
  const fp = BUILDING_FOOTPRINT.gassho;

  // 1. 石垣の土台（斜面に埋まるよう地中まで伸ばす）
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(fp.halfWidth * 2, 1.8, fp.halfDepth * 2), p.stone));
  base.position.y = -0.1;
  house.add(base);

  // 2. 木造の躯体
  const body = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(BODY_HALF_W * 2, WALL_TOP_Y - 0.8, BODY_HALF_D * 2), p.woodDark),
  );
  body.position.y = 0.8 + (WALL_TOP_Y - 0.8) / 2;
  markCameraBlocker(body);
  house.add(body);

  // 白壁の帯
  const plaster = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(BODY_HALF_W * 2 + 0.1, 1.6, BODY_HALF_D * 2 + 0.1), p.plaster),
    false,
  );
  plaster.position.y = 3.2;
  house.add(plaster);

  // 柱（長辺・正面背面）
  const pillarGeoSide = new THREE.BoxGeometry(0.28, WALL_TOP_Y - 0.8, 0.28);
  for (let z = -BODY_HALF_D; z <= BODY_HALF_D + 0.01; z += 2) {
    for (const x of [-BODY_HALF_W - 0.06, BODY_HALF_W + 0.06]) {
      const pillar = new THREE.Mesh(pillarGeoSide, p.woodDark);
      pillar.position.set(x, body.position.y, z);
      house.add(pillar);
    }
  }
  for (let x = -BODY_HALF_W; x <= BODY_HALF_W + 0.01; x += 2.5) {
    for (const z of [-BODY_HALF_D - 0.06, BODY_HALF_D + 0.06]) {
      const pillar = new THREE.Mesh(pillarGeoSide, p.woodDark);
      pillar.position.set(x, body.position.y, z);
      house.add(pillar);
    }
  }
  // 胴差し（横木）
  const beamGeo = new THREE.BoxGeometry(BODY_HALF_W * 2 + 0.3, 0.25, BODY_HALF_D * 2 + 0.3);
  for (const y of [2.35, 4.05]) {
    const beam = new THREE.Mesh(beamGeo, p.woodDark);
    beam.position.y = y;
    house.add(beam);
  }

  // 3. 茅葺き屋根
  const roofGroup = new THREE.Group();
  roofGroup.position.y = EAVE_Y;
  const roof = createRoofGeometry();
  const roofMesh = shadowed(new THREE.Mesh(roof.geometry, [p.thatchEdge, p.thatch]));
  markCameraBlocker(roofMesh);
  roofGroup.add(roofMesh);

  // 棟
  const ridge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, ROOF_HALF_DEPTH * 2 + 0.3), p.thatchEdge));
  ridge.position.y = roof.ridgeHeight + 0.05;
  roofGroup.add(ridge);
  // 棟押さえの木
  const ridgeBarGeo = new THREE.BoxGeometry(1.25, 0.18, 0.18);
  for (let z = -ROOF_HALF_DEPTH + 0.8; z <= ROOF_HALF_DEPTH - 0.8; z += 1.6) {
    const bar = new THREE.Mesh(ridgeBarGeo, p.woodDark);
    bar.position.set(0, roof.ridgeHeight + 0.3, z);
    roofGroup.add(bar);
  }

  // 妻壁と妻面の窓（合掌造りの特徴的な多層の窓）
  const gableBaseY = WALL_TOP_Y - EAVE_Y;
  const gableHeight = roof.innerApex - gableBaseY;
  const gableHalf = (EAVE_HALF_SPAN - ROOF_THICKNESS / Math.sin(ROOF_PITCH)) * (1 - gableBaseY / roof.innerApex);
  const gableGeo = createGableGeometry(gableHalf, gableHeight);
  const windowGeo = new THREE.BoxGeometry(1.0, 0.9, 0.1);
  for (const side of [1, -1]) {
    const gable = shadowed(new THREE.Mesh(gableGeo, p.woodDark));
    gable.position.set(0, gableBaseY, side * BODY_HALF_D);
    roofGroup.add(gable);

    const rows: Array<{ y: number; xs: number[] }> = [
      { y: 1.6, xs: [-2.2, -0.75, 0.75, 2.2] },
      { y: 3.6, xs: [-1.2, 0, 1.2] },
      { y: 5.5, xs: [-0.5, 0.5] },
    ];
    for (const row of rows) {
      for (const x of row.xs) {
        const win = new THREE.Mesh(windowGeo, p.shoji);
        win.position.set(x, gableBaseY + row.y, side * (BODY_HALF_D + 0.14));
        roofGroup.add(win);
      }
    }
  }
  house.add(roofGroup);

  // 4. 正面の玄関と障子窓
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 0.2), p.woodDark);
  doorFrame.position.set(0, 2.0, BODY_HALF_D + 0.08);
  house.add(doorFrame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.15, 0.1), p.woodLight);
  door.position.set(0, 1.95, BODY_HALF_D + 0.17);
  house.add(door);

  const frameGeo = new THREE.BoxGeometry(1.6, 1.3, 0.12);
  const paperGeo = new THREE.BoxGeometry(1.4, 1.1, 0.1);
  for (const x of [-3.2, 3.2]) {
    const frame = new THREE.Mesh(frameGeo, p.woodDark);
    frame.position.set(x, 2.2, BODY_HALF_D + 0.1);
    house.add(frame);
    const paper = new THREE.Mesh(paperGeo, p.shoji);
    paper.position.set(x, 2.2, BODY_HALF_D + 0.15);
    house.add(paper);
  }
  // 長辺の障子窓
  for (const z of [-4, 0, 4]) {
    for (const side of [1, -1]) {
      const paper = new THREE.Mesh(paperGeo, p.shoji);
      paper.rotation.y = Math.PI / 2;
      paper.position.set(side * (BODY_HALF_W + 0.13), 2.0, z);
      house.add(paper);
    }
  }

  return house;
}
