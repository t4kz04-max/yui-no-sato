import * as THREE from 'three';
import { smoothstep, type Vec2 } from '../../core/math';
import { fbm, hashUnit } from '../../core/noise';
import { createRandom } from '../../core/random';
import {
  BRIDGE,
  BUILDING_FOOTPRINT,
  FIELD,
  PADDIES,
  PROP_FOOTPRINT,
  WATERWAY,
  distanceToSegment,
  type BuildingDef,
  type FieldDef,
  type MountainRangeDef,
  type PathDef,
  type PropDef,
  type TreeDef,
} from '../layout';
import { bridgeDeckHeight, terrainHeight } from '../terrain';
import { markCameraBlocker, shadowed, type Palette } from './materials';

const TERRAIN_SIZE = 280;
const TERRAIN_SEGMENTS = 186; // 約1.5m間隔

/** 地形メッシュ。高さは terrainHeight() と同じ関数から作るので、接地と見た目が一致する。 */
export function createTerrainMesh(p: Palette, paths: readonly PathDef[]): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x76823f);
  const grassDry = new THREE.Color(0x9c9150);
  const grassDeep = new THREE.Color(0x5e6e36);
  const trodden = new THREE.Color(0x8a7a52);
  const forest = new THREE.Color(0x3c4f31);
  const bank = new THREE.Color(0x6c6448);
  const bed = new THREE.Color(0x4f4535);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    // 色：秋の草地（乾いた所・濃い所のむら）→ 道の脇の踏まれた所 → 外周の森 → 水路の岸と底
    const patch = fbm(x * 0.06, z * 0.06, 5);
    c.copy(grass).lerp(grassDry, smoothstep(0.45, 0.75, patch)).lerp(grassDeep, smoothstep(0.45, 0.2, patch) * 0.7);
    let nearPath = Infinity;
    for (const path of paths) {
      for (let k = 0; k + 1 < path.points.length; k++) {
        nearPath = Math.min(nearPath, distanceToSegment(x, z, path.points[k]!, path.points[k + 1]!) - path.width / 2);
      }
    }
    c.lerp(trodden, (1 - smoothstep(0, 1.6, nearPath)) * 0.55);
    c.lerp(forest, smoothstep(50, 75, Math.hypot(x, z + 3)));
    const dz = Math.abs(z - WATERWAY.centerZ);
    c.lerp(bank, (1 - smoothstep(WATERWAY.halfWidth + 0.5, WATERWAY.halfWidth + 1.6, dz)) * 0.8);
    c.lerp(bed, 0.9 * (1 - smoothstep(WATERWAY.halfWidth, WATERWAY.halfWidth + 1, dz)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, p.terrain);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** 地形に沿わせた帯（道）のジオメトリ。 */
function drapedRibbon(points: readonly Vec2[], width: number, lift: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const step = 0.8;
  const samples: Array<{ x: number; z: number; nx: number; nz: number }> = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx, nz });
    }
  }
  const half = width / 2;
  for (const s of samples) {
    for (const side of [-1, 1]) {
      const x = s.x + s.nx * half * side;
      const z = s.z + s.nz * half * side;
      positions.push(x, terrainHeight(x, z) + lift, z);
    }
  }
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 地形に沿わせた円盤（道の継ぎ目・広場）。 */
function drapedDisc(center: Vec2, radius: number, lift: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center.x;
    const z = pos.getZ(i) + center.z;
    pos.setXYZ(i, x, terrainHeight(x, z) + lift, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 地形に沿わせた長方形（田畑）。 */
function drapedRect(f: FieldDef, lift: number, segments = 10): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(f.halfWidth * 2, f.halfDepth * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + f.position.x;
    const z = pos.getZ(i) + f.position.z;
    pos.setXYZ(i, x, terrainHeight(x, z) + lift, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createPaths(p: Palette, paths: readonly PathDef[], plaza: { center: Vec2; radius: number }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'paths';
  for (const path of paths) {
    g.add(shadowed(new THREE.Mesh(drapedRibbon(path.points, path.width, 0.04), p.path), false));
    for (const pt of path.points) {
      g.add(shadowed(new THREE.Mesh(drapedDisc(pt, path.width / 2, 0.04), p.path), false));
    }
  }
  g.add(shadowed(new THREE.Mesh(drapedDisc(plaza.center, plaza.radius, 0.035), p.path), false));
  return g;
}

/** 水路：水面と、両岸の石積み（橋の所は空ける）。 */
export function createWaterway(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'waterway';
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WATERWAY.maxX - WATERWAY.minX, WATERWAY.halfWidth * 2 + 0.6).rotateX(-Math.PI / 2),
    p.water,
  );
  water.position.set((WATERWAY.minX + WATERWAY.maxX) / 2, WATERWAY.waterLevel, WATERWAY.centerZ);
  water.receiveShadow = true;
  g.add(water);

  const stones: THREE.Matrix4[] = [];
  const rand = createRandom(29);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const side of [-1, 1]) {
    const z0 = WATERWAY.centerZ + side * (WATERWAY.halfWidth + 0.15);
    for (let x = -60; x <= 60; x += 0.75 + rand() * 0.35) {
      if (Math.abs(x - BRIDGE.x) < BRIDGE.halfWidth + 0.9) continue;
      const s = 0.38 + rand() * 0.22;
      const z = z0 + (rand() - 0.5) * 0.25;
      e.set(rand() * 0.6, rand() * Math.PI, rand() * 0.6);
      q.setFromEuler(e);
      const y = Math.min(terrainHeight(x, z), WATERWAY.waterLevel + 0.55) - 0.05;
      stones.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s * 1.3, s * 0.8, s)));
    }
  }
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), p.rock, stones.length);
  stones.forEach((m, i) => rocks.setMatrixAt(i, m));
  rocks.receiveShadow = true;
  rocks.name = 'bank-stones';
  g.add(rocks);
  return g;
}

/** 水路に架かる小さな木橋。床面の高さは bridgeDeckHeight() と一致させる。 */
export function createBridge(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bridge';
  const width = BRIDGE.halfWidth * 2 + 0.2;
  const segments = 12;
  const len = BRIDGE.endZ - BRIDGE.startZ;
  const segLen = len / segments;
  const plankGeo = new THREE.BoxGeometry(width, 0.2, segLen + 0.06);
  for (let i = 0; i < segments; i++) {
    const z = BRIDGE.startZ + segLen * (i + 0.5);
    const plank = shadowed(new THREE.Mesh(plankGeo, i % 2 === 0 ? p.woodWeathered : p.woodLight));
    plank.position.set(BRIDGE.x, bridgeDeckHeight(z) - 0.1, z);
    const slope = (bridgeDeckHeight(z + 0.01) - bridgeDeckHeight(z - 0.01)) / 0.02;
    plank.rotation.x = -Math.atan(slope);
    g.add(plank);
  }
  // 橋桁と橋脚
  for (const side of [-1, 1]) {
    const beam = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, len), p.woodDark), false);
    beam.position.set(BRIDGE.x + side * (BRIDGE.halfWidth - 0.2), bridgeDeckHeight(BRIDGE.startZ + len / 2) - 0.35, BRIDGE.startZ + len / 2);
    g.add(beam);
    for (const z of [WATERWAY.centerZ - 1.1, WATERWAY.centerZ + 1.1]) {
      const pier = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.4, 6), p.woodDark), false);
      pier.position.set(BRIDGE.x + side * (BRIDGE.halfWidth - 0.2), WATERWAY.waterLevel - 0.1 + 0.4, z);
      g.add(pier);
    }
  }
  // 橋のたもとの石
  for (const z of [BRIDGE.startZ - 0.3, BRIDGE.endZ + 0.3]) {
    for (const side of [-1, 1]) {
      const stone = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), p.stone));
      stone.position.set(BRIDGE.x + side * (BRIDGE.halfWidth + 0.35), terrainHeight(BRIDGE.x, z) + 0.15, z);
      g.add(stone);
    }
  }
  // 欄干
  const postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14);
  const railX = BRIDGE.halfWidth + 0.08;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const z = BRIDGE.startZ + 0.3 + ((len - 0.6) * i) / 4;
      const post = shadowed(new THREE.Mesh(postGeo, p.woodDark));
      post.position.set(BRIDGE.x + side * railX, bridgeDeckHeight(z) + 0.4, z);
      g.add(post);
    }
    const railPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const z = BRIDGE.startZ + 0.3 + ((len - 0.6) * i) / 10;
      railPoints.push(new THREE.Vector3(BRIDGE.x + side * railX, bridgeDeckHeight(z) + 0.85, z));
    }
    const rail = shadowed(
      new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 16, 0.06, 5), p.woodDark),
    );
    g.add(rail);
  }
  return g;
}

/** 伊助家の畑（収穫期）。 */
export function createField(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'field';
  const { position, halfWidth, halfDepth } = FIELD;
  g.add(shadowed(new THREE.Mesh(drapedRect(FIELD, 0.03), p.soil), false));
  // 作物の畝（東西方向）。一部は刈り取り済みで、作業の途中だと分かるように
  const rand = createRandom(7);
  const rowGeo = new THREE.BoxGeometry(halfWidth * 2 - 1, 0.7, 0.55);
  const stalkGeo = new THREE.ConeGeometry(0.16, 0.5, 4);
  for (let z = position.z - halfDepth + 1; z <= position.z + halfDepth - 1; z += 1.1) {
    const harvested = rand() < 0.3;
    const row = shadowed(new THREE.Mesh(rowGeo, harvested ? p.stubble : p.crop));
    row.scale.y = harvested ? 0.2 : 1;
    row.position.set(position.x, terrainHeight(position.x, z) + (harvested ? 0.08 : 0.35), z);
    g.add(row);
    if (!harvested) {
      // 穂先の揺らぎ
      for (let x = position.x - halfWidth + 1; x < position.x + halfWidth - 0.6; x += 0.7) {
        const stalk = shadowed(new THREE.Mesh(stalkGeo, p.crop), false);
        stalk.position.set(x + rand() * 0.2, terrainHeight(x, z) + 0.85, z + (rand() - 0.5) * 0.2);
        stalk.rotation.z = (rand() - 0.5) * 0.3;
        g.add(stalk);
      }
    }
  }
  // 柵
  const postGeo = new THREE.BoxGeometry(0.12, 0.9, 0.12);
  const railGeo = new THREE.BoxGeometry(0.06, 0.06, 2.0);
  for (let z = position.z - halfDepth; z <= position.z + halfDepth + 0.01; z += 2) {
    for (const x of [position.x - halfWidth, position.x + halfWidth]) {
      const post = shadowed(new THREE.Mesh(postGeo, p.woodWeathered));
      post.position.set(x, terrainHeight(x, z) + 0.4, z);
      g.add(post);
      if (z + 2 <= position.z + halfDepth + 0.01) {
        const rail = shadowed(new THREE.Mesh(railGeo, p.woodWeathered), false);
        rail.position.set(x, terrainHeight(x, z + 1) + 0.65, z + 1);
        g.add(rail);
      }
    }
  }
  return g;
}

/** 水路の南の田んぼ：刈り取りの済んだ田と、まわりの畦。 */
export function createPaddies(p: Palette, paddies: readonly FieldDef[] = PADDIES): THREE.Group {
  const g = new THREE.Group();
  g.name = 'paddies';
  for (const f of paddies) {
    g.add(shadowed(new THREE.Mesh(drapedRect(f, 0.03), p.stubble), false));
    // 切り株の列
    const rowGeo = new THREE.BoxGeometry(f.halfWidth * 2 - 0.8, 0.06, 0.1);
    for (let z = f.position.z - f.halfDepth + 0.5; z <= f.position.z + f.halfDepth - 0.5; z += 0.45) {
      const row = shadowed(new THREE.Mesh(rowGeo, p.stubbleRow), false, true);
      row.position.set(f.position.x, terrainHeight(f.position.x, z) + 0.07, z);
      g.add(row);
    }
    // 畦（低い土手。歩いて越えられる高さ）
    for (const [w, d, x, z] of [
      [f.halfWidth * 2 + 0.5, 0.45, f.position.x, f.position.z - f.halfDepth],
      [f.halfWidth * 2 + 0.5, 0.45, f.position.x, f.position.z + f.halfDepth],
      [0.45, f.halfDepth * 2, f.position.x - f.halfWidth, f.position.z],
      [0.45, f.halfDepth * 2, f.position.x + f.halfWidth, f.position.z],
    ] as const) {
      const ridge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), p.grass), false, true);
      ridge.position.set(x, terrainHeight(x, z) + 0.02, z);
      g.add(ridge);
    }
  }
  return g;
}

/**
 * 森（全樹木）を InstancedMesh で描く。部品（幹・葉）とマテリアルの組み合わせごとに
 * 1回の描画呼び出しで済むため、木の本数を増やしても負荷が増えにくい。
 */
export function createForest(p: Palette, trees: readonly TreeDef[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'forest';
  const geos = {
    trunk: new THREE.CylinderGeometry(0.32, 0.55, 4.4, 7).translate(0, 2.2, 0),
    cedar1: new THREE.ConeGeometry(2.7, 4.4, 8).translate(0, 4.2, 0),
    cedar2: new THREE.ConeGeometry(2.1, 3.8, 8).translate(0, 6.2, 0),
    cedar3: new THREE.ConeGeometry(1.3, 3.0, 8).translate(0, 8.2, 0),
    crown: new THREE.IcosahedronGeometry(1.8, 1),
  };
  const crownOffsets: Array<[number, number, number, number]> = [
    [0, 5, 0, 1.3],
    [1.2, 4.4, 0.4, 0.95],
    [-1.1, 4.6, -0.5, 1.0],
    [0.2, 5.9, -0.8, 0.85],
    [-0.4, 4.0, 1.0, 0.8],
  ];

  type Batch = { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: THREE.Matrix4[]; colors: THREE.Color[] };
  const batches = new Map<string, Batch>();
  const push = (geoKey: keyof typeof geos, mat: THREE.Material, m: THREE.Matrix4, tint: number) => {
    const key = `${geoKey}|${mat.uuid}`;
    let b = batches.get(key);
    if (!b) {
      b = { geo: geos[geoKey], mat, matrices: [], colors: [] };
      batches.set(key, b);
    }
    b.matrices.push(m);
    b.colors.push(new THREE.Color(tint, tint, tint));
  };

  const base = new THREE.Matrix4();
  const part = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  trees.forEach((def, index) => {
    const { x, z } = def.position;
    q.setFromAxisAngle(up, index * 1.7);
    base.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q, new THREE.Vector3().setScalar(def.scale));
    const tint = 0.85 + hashUnit(index, 3) * 0.3;
    push('trunk', p.trunk, base.clone(), 1);
    if (def.kind === 'cedar') {
      push('cedar1', index % 2 ? p.cedarLeaves : p.cedarLeavesDark, base.clone(), tint);
      push('cedar2', p.cedarLeavesDark, base.clone(), tint);
      push('cedar3', p.cedarLeaves, base.clone(), tint);
    } else {
      const leaf = def.kind === 'maple' ? (index % 2 ? p.mapleLeaves : p.mapleLeavesOrange) : p.broadleafLeaves;
      for (const [ox, oy, oz, s] of crownOffsets) {
        part.makeScale(s, s * 0.9, s).setPosition(ox, oy, oz);
        push('crown', leaf, base.clone().multiply(part), tint);
      }
    }
  });

  for (const b of batches.values()) {
    const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.matrices.length);
    b.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, b.colors[i]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    shadowed(mesh);
    // 木の裏にプレイヤーが隠れないよう、カメラの遮蔽判定に含める
    markCameraBlocker(mesh);
    g.add(mesh);
  }
  return g;
}

export interface ClearArea {
  readonly buildings: readonly BuildingDef[];
  readonly props: readonly PropDef[];
  readonly paths: readonly PathDef[];
  /** 調べられる物・住民の立ち位置（草で隠さない）。 */
  readonly keep: readonly Vec2[];
}

/** 草むら（背の低い草の株）。道・建物・小物・田畑・水路・調べられる物の周りには置かない。当たり判定なし。 */
export function createGrass(p: Palette, clear: ClearArea): THREE.InstancedMesh {
  const blade = new THREE.ConeGeometry(0.07, 0.5, 3).translate(0, 0.25, 0);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const b = blade.clone();
    b.rotateZ((i - 2) * 0.22).rotateY(i * 1.3).translate(Math.cos(i * 2.1) * 0.12, 0, Math.sin(i * 2.1) * 0.12);
    parts.push(b);
  }
  const tuft = mergeSimple(parts);
  const rand = createRandom(61);
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const blocked = (x: number, z: number) => {
    if (Math.abs(z - WATERWAY.centerZ) < WATERWAY.halfWidth + 1.2) return true;
    for (const f of [FIELD, ...PADDIES]) {
      if (Math.abs(x - f.position.x) < f.halfWidth + 0.8 && Math.abs(z - f.position.z) < f.halfDepth + 0.8) return true;
    }
    for (const b of clear.buildings) {
      const fp = BUILDING_FOOTPRINT[b.kind];
      if (Math.hypot(x - b.position.x, z - b.position.z) < Math.max(fp.halfWidth, fp.halfDepth) * b.scale + 1) return true;
    }
    for (const prop of clear.props) {
      const fp = PROP_FOOTPRINT[prop.kind];
      const r = fp ? ('radius' in fp ? fp.radius : Math.max(fp.halfWidth, fp.halfDepth)) : 0.5;
      if (Math.hypot(x - prop.position.x, z - prop.position.z) < r * (prop.scale ?? 1) + 0.8) return true;
    }
    for (const k of clear.keep) if (Math.hypot(x - k.x, z - k.z) < 1.8) return true;
    for (const path of clear.paths) {
      for (let i = 0; i + 1 < path.points.length; i++) {
        if (distanceToSegment(x, z, path.points[i]!, path.points[i + 1]!) < path.width / 2 + 0.7) return true;
      }
    }
    if (Math.hypot(x, z - 15.5) < 6.5) return true; // 広場
    return false;
  };
  for (let i = 0; i < 2600 && matrices.length < 1100; i++) {
    const x = (rand() - 0.5) * 100;
    const z = -45 + rand() * 84;
    // 群れて生えるように、ノイズの濃い所にだけ置く
    if (fbm(x * 0.12, z * 0.12, 9) < 0.48 || blocked(x, z)) continue;
    const s = 0.6 + rand() * 0.7;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.03, z), q, new THREE.Vector3(s, s, s)));
    const t = 0.85 + rand() * 0.3;
    colors.push(new THREE.Color(t, t * (0.95 + rand() * 0.08), t * 0.9));
  }
  const mesh = new THREE.InstancedMesh(tuft, p.grass, matrices.length);
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, colors[i]!);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  return mesh;
}

/** 同じ属性のジオメトリを一つにまとめる（草の株など、小さな部品用）。 */
function mergeSimple(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const geo of geos) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    positions.push(...(g.attributes.position as THREE.BufferAttribute).array);
    normals.push(...(g.attributes.normal as THREE.BufferAttribute).array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return out;
}

/**
 * 遠景の山並み。尾根の輪郭を 3 層重ね、遠いほど空の色に近づける（大気遠近）。
 * 霧の影響を受けない代わりに、面ごとの明るさと空の色との混ぜ具合を頂点色に焼き込む（描画は 1 層 1 回）。
 */
export function createMountainRanges(ranges: readonly MountainRangeDef[], skyColor: THREE.Color, sunDir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mountains';
  const segs = 160;
  const near = new THREE.Color(0x4a5c42);
  const autumn = new THREE.Color(0x8a6a3a);
  const red = new THREE.Color(0x8a4a30);
  const rock = new THREE.Color(0x6f6a5c);
  const sun = sunDir.clone().normalize();
  for (const r of ranges) {
    const rows = [
      { dr: -24, h: () => -8 },
      { dr: 0, h: (t: number) => r.height * 0.5 + (fbm(t * 9, 1, r.seed + 1) - 0.5) * r.variation * 0.6 },
      { dr: 26, h: (t: number) => r.height + (fbm(t * 6, 2, r.seed) - 0.5) * r.variation * 2 },
    ];
    const pts: THREE.Vector3[][] = rows.map((row) => {
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const a = t * Math.PI * 2;
        const dist = r.distance + row.dr + (fbm(t * 11, 5, r.seed + 3) - 0.5) * 20;
        ring.push(new THREE.Vector3(Math.cos(a) * dist, row.h(t), Math.sin(a) * dist - 3));
      }
      return ring;
    });
    const positions: number[] = [];
    const colors: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) => {
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (n.y < 0) n.negate();
      const light = 0.55 + 0.45 * Math.max(0, n.dot(sun));
      const patch = fbm(t * 30, (a.y + b.y + c.y) * 0.02, r.seed + 7);
      const base = near.clone().lerp(autumn, smoothstep(0.5, 0.7, patch)).lerp(red, smoothstep(0.7, 0.85, patch) * 0.6);
      const top = Math.max(a.y, b.y, c.y);
      base.lerp(rock, smoothstep(r.height * 0.9, r.height * 1.4, top) * 0.5);
      const c0 = base.multiplyScalar(light).lerp(skyColor, r.haze);
      for (const v of [a, b, c]) {
        positions.push(v.x, v.y, v.z);
        colors.push(c0.r, c0.g, c0.b);
      }
    };
    for (let k = 0; k + 1 < rows.length; k++) {
      for (let i = 0; i < segs; i++) {
        const a = pts[k]![i]!;
        const b = pts[k]![i + 1]!;
        const c = pts[k + 1]![i + 1]!;
        const d = pts[k + 1]![i]!;
        tri(a, b, c, i / segs);
        tri(a, c, d, i / segs);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    mesh.name = `mountain-range-${r.distance}`;
    // 奥の層から描く（手前の層が上に重なる）
    mesh.renderOrder = -Math.round(r.distance / 10);
    g.add(mesh);
  }
  return g;
}
