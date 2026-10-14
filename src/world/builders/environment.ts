import * as THREE from 'three';
import { smoothstep, type Vec2 } from '../../core/math';
import { createRandom } from '../../core/random';
import {
  BRIDGE,
  FIELD,
  WATERWAY,
  type MountainDef,
  type PathDef,
  type TreeDef,
} from '../layout';
import { bridgeDeckHeight, terrainHeight } from '../terrain';
import { markCameraBlocker, shadowed, type Palette } from './materials';

const TERRAIN_SIZE = 280;
const TERRAIN_SEGMENTS = 186; // 約1.5m間隔

/** 地形メッシュ。高さは terrainHeight() と同じ関数から作るので、接地と見た目が一致する。 */
export function createTerrainMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x6f7d3c);
  const grassDry = new THREE.Color(0x8d8a48);
  const forest = new THREE.Color(0x3f5232);
  const bed = new THREE.Color(0x5a4d3c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // 色：秋の草地 → 外周の森 → 水路の底
    const patch = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) * 0.5;
    c.copy(grass).lerp(grassDry, patch * 0.45);
    c.lerp(forest, smoothstep(50, 75, Math.hypot(x, z + 3)));
    c.lerp(bed, 0.9 * (1 - smoothstep(WATERWAY.halfWidth, WATERWAY.halfWidth + 1, Math.abs(z - WATERWAY.centerZ))));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
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
  g.add(
    shadowed(
      new THREE.Mesh(
        drapedRibbon(
          [
            { x: position.x, z: position.z - halfDepth },
            { x: position.x, z: position.z + halfDepth },
          ],
          halfWidth * 2,
          0.03,
        ),
        p.soil,
      ),
      false,
    ),
  );
  // 作物の畝（東西方向）
  const rand = createRandom(7);
  const rowGeo = new THREE.BoxGeometry(halfWidth * 2 - 1, 0.7, 0.55);
  for (let z = position.z - halfDepth + 1; z <= position.z + halfDepth - 1; z += 1.1) {
    // 一部の畝は収穫済み（低い）にして、作業途中の様子を見せる
    const harvested = rand() < 0.3;
    const row = shadowed(new THREE.Mesh(rowGeo, harvested ? p.thatch : p.crop));
    row.scale.y = harvested ? 0.25 : 1;
    row.position.set(position.x, terrainHeight(position.x, z) + (harvested ? 0.1 : 0.35), z);
    g.add(row);
  }
  // 柵
  const postGeo = new THREE.BoxGeometry(0.12, 0.9, 0.12);
  const addPost = (x: number, z: number) => {
    const post = shadowed(new THREE.Mesh(postGeo, p.woodWeathered));
    post.position.set(x, terrainHeight(x, z) + 0.4, z);
    g.add(post);
  };
  for (let z = position.z - halfDepth; z <= position.z + halfDepth + 0.01; z += 2) {
    addPost(position.x - halfWidth, z);
    addPost(position.x + halfWidth, z);
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
    trunk: new THREE.CylinderGeometry(0.4, 0.6, 4, 7).translate(0, 2, 0),
    cedar1: new THREE.ConeGeometry(2.8, 5.5, 7).translate(0, 5, 0),
    cedar2: new THREE.ConeGeometry(2.1, 4.5, 7).translate(0, 7.6, 0),
    crown: new THREE.IcosahedronGeometry(1.8, 1),
  };
  const crownOffsets: Array<[number, number, number, number]> = [
    [0, 5, 0, 1.3],
    [1.2, 4.4, 0.4, 0.95],
    [-1.1, 4.6, -0.5, 1.0],
    [0.2, 5.9, -0.8, 0.85],
  ];

  const batches = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: THREE.Matrix4[] }>();
  const push = (geoKey: keyof typeof geos, mat: THREE.Material, m: THREE.Matrix4) => {
    const key = `${geoKey}|${mat.uuid}`;
    let b = batches.get(key);
    if (!b) {
      b = { geo: geos[geoKey], mat, matrices: [] };
      batches.set(key, b);
    }
    b.matrices.push(m);
  };

  const base = new THREE.Matrix4();
  const part = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  trees.forEach((def, index) => {
    const { x, z } = def.position;
    q.setFromAxisAngle(up, index * 1.7);
    base.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q, new THREE.Vector3().setScalar(def.scale));
    push('trunk', p.trunk, base.clone());
    if (def.kind === 'cedar') {
      push('cedar1', index % 2 ? p.cedarLeaves : p.cedarLeavesDark, base.clone());
      push('cedar2', p.cedarLeavesDark, base.clone());
    } else {
      const leaf = def.kind === 'maple' ? (index % 2 ? p.mapleLeaves : p.mapleLeavesOrange) : p.broadleafLeaves;
      for (const [ox, oy, oz, s] of crownOffsets) {
        part.makeScale(s, s, s).setPosition(ox, oy, oz);
        push('crown', leaf, base.clone().multiply(part));
      }
    }
  });

  for (const b of batches.values()) {
    const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.matrices.length);
    b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    shadowed(mesh);
    // 木の裏にプレイヤーが隠れないよう、カメラの遮蔽判定に含める
    markCameraBlocker(mesh);
    g.add(mesh);
  }
  return g;
}

export function createMountains(p: Palette, mountains: readonly MountainDef[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mountains';
  for (const m of mountains) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(m.radius, m.height, 9, 3), p.mountain);
    mesh.position.set(m.position.x, m.height / 2 - 6, m.position.z);
    mesh.rotation.y = m.radius;
    g.add(mesh);
  }
  return g;
}
