import * as THREE from 'three';
import { boardTexture, groundDetailTexture, shojiTexture, thatchCutTexture, thatchTexture } from '../../render/textures';

/**
 * 村全体で共有するマテリアル。色の統一感を保ち、描画状態の切り替えも減らす。
 * 色は秋の午後の柔らかい光に合わせ、彩度を抑えた暖色を基本にする（docs/PHASE5_ART.md）。
 * 名前のある住民の服の色は、ここにある背景の色と重ならないようにしている（src/content/characters.ts）。
 */
export interface Palette {
  readonly woodDark: THREE.MeshStandardMaterial;
  readonly woodLight: THREE.MeshStandardMaterial;
  readonly woodWeathered: THREE.MeshStandardMaterial;
  /** 板壁（板目のテクスチャ付き）。 */
  readonly woodWall: THREE.MeshStandardMaterial;
  readonly plaster: THREE.MeshStandardMaterial;
  readonly shoji: THREE.MeshStandardMaterial;
  readonly stone: THREE.MeshStandardMaterial;
  /** 茅葺き屋根の上面（頂点色＋繊維のテクスチャ）。 */
  readonly thatchTop: THREE.MeshStandardMaterial;
  /** 茅の切り口と裏面（頂点色＋切り口のテクスチャ）。 */
  readonly thatchCut: THREE.MeshStandardMaterial;
  /** 棟や小屋に使う、古い茅の色。 */
  readonly thatch: THREE.MeshStandardMaterial;
  readonly thatchEdge: THREE.MeshStandardMaterial;
  /** 束ねた新しい茅。 */
  readonly thatchFresh: THREE.MeshStandardMaterial;
  readonly path: THREE.MeshStandardMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly crop: THREE.MeshStandardMaterial;
  /** 刈り取った後の田（切り株）。 */
  readonly stubble: THREE.MeshStandardMaterial;
  /** 田の切り株の列。 */
  readonly stubbleRow: THREE.MeshStandardMaterial;
  readonly water: THREE.MeshStandardMaterial;
  readonly trunk: THREE.MeshStandardMaterial;
  readonly cedarLeaves: THREE.MeshStandardMaterial;
  readonly cedarLeavesDark: THREE.MeshStandardMaterial;
  readonly mapleLeaves: THREE.MeshStandardMaterial;
  readonly mapleLeavesOrange: THREE.MeshStandardMaterial;
  readonly broadleafLeaves: THREE.MeshStandardMaterial;
  readonly grass: THREE.MeshStandardMaterial;
  readonly mountain: THREE.MeshStandardMaterial;
  readonly rock: THREE.MeshStandardMaterial;
  readonly rope: THREE.MeshStandardMaterial;
  readonly iron: THREE.MeshStandardMaterial;
  /** 地形（頂点色＋細かな揺らぎ）。 */
  readonly terrain: THREE.MeshStandardMaterial;
}

function mat(color: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
}

export function createPalette(): Palette {
  const thatchMap = thatchTexture();
  const cutMap = thatchCutTexture();
  const board = boardTexture();
  const shoji = shojiTexture();
  return {
    woodDark: mat(0x35231a, 0.85),
    woodLight: mat(0x8c6a45, 0.8),
    woodWeathered: mat(0x6a5844, 0.9),
    woodWall: mat(0x5a3f2a, 0.88, { map: board }),
    plaster: mat(0xd9d3c1, 0.75),
    shoji: mat(0xffffff, 0.9, { map: shoji, emissive: 0x3a2c18, emissiveIntensity: 0.35 }),
    stone: mat(0x6c6a63, 0.95),
    thatchTop: mat(0xffffff, 1, { map: thatchMap, vertexColors: true, side: THREE.DoubleSide }),
    thatchCut: mat(0xffffff, 1, { map: cutMap, vertexColors: true, side: THREE.DoubleSide }),
    thatch: mat(0x7d6747, 0.98, { map: thatchMap }),
    thatchEdge: mat(0x5e4b33, 0.98, { map: thatchMap }),
    thatchFresh: mat(0xc9a961, 0.95, { map: thatchMap }),
    path: mat(0x9a8063, 0.97, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    soil: mat(0x5b4633, 0.98, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    crop: mat(0xcfa848, 0.85),
    stubble: mat(0xa08a55, 0.98, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    stubbleRow: mat(0x86703f, 0.98),
    water: mat(0x4f8590, 0.12, { metalness: 0.05, transparent: true, opacity: 0.85 }),
    trunk: mat(0x4a3728, 0.9),
    cedarLeaves: mat(0x2f4a30, 0.85),
    cedarLeavesDark: mat(0x3a5a3a, 0.85),
    mapleLeaves: mat(0xb8432a, 0.8),
    mapleLeavesOrange: mat(0xd27a2c, 0.8),
    broadleafLeaves: mat(0x8f9a40, 0.85),
    grass: mat(0x7d8840, 0.95),
    mountain: mat(0x47604f, 0.95, { flatShading: true }),
    rock: mat(0x77736b, 0.95, { flatShading: true }),
    rope: mat(0xb8a27a, 0.95),
    iron: mat(0x3a3a3c, 0.6, { metalness: 0.4 }),
    terrain: mat(0xffffff, 0.95, { vertexColors: true, map: groundDetailTexture() }),
  };
}

/** カメラの壁抜け防止レイキャストの対象にする印。 */
export function markCameraBlocker(obj: THREE.Object3D): void {
  obj.userData.cameraBlocker = true;
}

export function shadowed<T extends THREE.Mesh>(mesh: T, cast = true, receive = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/**
 * 箱の UV を実寸に合わせる（tile m ごとにテクスチャを 1 回繰り返す）。
 * 大きさの違う板壁でも、板の幅がそろって見えるようにする。
 */
export function boxWithWorldUv(w: number, h: number, d: number, tile = 2): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // 面の順：+x, -x, +y, -y, +z, -z（各 4 頂点）
  const sizes: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = sizes[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  return geo;
}
