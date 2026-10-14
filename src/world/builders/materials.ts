import * as THREE from 'three';

/**
 * 村全体で共有するマテリアル。色の統一感を保ち、描画状態の切り替えも減らす。
 * 色は既存試作の配色を基に、秋の柔らかい光に合わせて調整している。
 */
export interface Palette {
  readonly woodDark: THREE.MeshStandardMaterial;
  readonly woodLight: THREE.MeshStandardMaterial;
  readonly woodWeathered: THREE.MeshStandardMaterial;
  readonly plaster: THREE.MeshStandardMaterial;
  readonly shoji: THREE.MeshStandardMaterial;
  readonly stone: THREE.MeshStandardMaterial;
  readonly thatch: THREE.MeshStandardMaterial;
  readonly thatchEdge: THREE.MeshStandardMaterial;
  readonly thatchFresh: THREE.MeshStandardMaterial;
  readonly path: THREE.MeshStandardMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly crop: THREE.MeshStandardMaterial;
  readonly water: THREE.MeshStandardMaterial;
  readonly trunk: THREE.MeshStandardMaterial;
  readonly cedarLeaves: THREE.MeshStandardMaterial;
  readonly cedarLeavesDark: THREE.MeshStandardMaterial;
  readonly mapleLeaves: THREE.MeshStandardMaterial;
  readonly mapleLeavesOrange: THREE.MeshStandardMaterial;
  readonly broadleafLeaves: THREE.MeshStandardMaterial;
  readonly mountain: THREE.MeshStandardMaterial;
  readonly rock: THREE.MeshStandardMaterial;
}

function mat(color: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
}

export function createPalette(): Palette {
  return {
    woodDark: mat(0x3d2817, 0.85),
    woodLight: mat(0x8c6239, 0.8),
    woodWeathered: mat(0x5c4a38, 0.9),
    plaster: mat(0xd9d3c1, 0.75),
    shoji: mat(0xf5f0dc, 0.9, { emissive: 0x332211, emissiveIntensity: 0.25 }),
    stone: mat(0x5e5c58, 0.95),
    thatch: mat(0x7a6446, 0.98),
    thatchEdge: mat(0x5e4b33, 0.98),
    thatchFresh: mat(0xb39a64, 0.98),
    path: mat(0x8a7158, 0.97, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    soil: mat(0x5b4633, 0.98, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    crop: mat(0xc9a646, 0.85),
    water: mat(0x4d7f8c, 0.15, { metalness: 0.1, transparent: true, opacity: 0.82 }),
    trunk: mat(0x4a3728, 0.9),
    cedarLeaves: mat(0x2e4a2d, 0.85),
    cedarLeavesDark: mat(0x3b5c38, 0.85),
    mapleLeaves: mat(0xb8432a, 0.8),
    mapleLeavesOrange: mat(0xd27a2c, 0.8),
    broadleafLeaves: mat(0x8a9a3c, 0.85),
    mountain: mat(0x47604f, 0.95, { flatShading: true }),
    rock: mat(0x6e6b66, 0.95, { flatShading: true }),
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
