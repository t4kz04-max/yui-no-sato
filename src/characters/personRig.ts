import * as THREE from 'three';

/**
 * 人物の仮モデル（プレイヤー・住民で共通）。既存試作の笠をかぶった人物を元に、
 * 服の色・かぶり物・背丈を変えられるようにした。Phase 5 で本格的なモデルに置き換える前提。
 */
export type Headwear = 'straw' | 'kerchief' | 'none';

export interface PersonAppearance {
  readonly cloth: number;
  readonly limb: number;
  readonly skin: number;
  readonly hair: number;
  readonly headwear: Headwear;
  /** かぶり物の色（straw / kerchief のとき）。 */
  readonly headwearColor?: number;
  /** 背丈の倍率。 */
  readonly height?: number;
}

export interface PersonRig {
  readonly root: THREE.Group;
  /** 全身をまとめたグループ（歩行時の上下の揺れに使う）。 */
  readonly body: THREE.Group;
  readonly leftLeg: THREE.Group;
  readonly rightLeg: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightArm: THREE.Group;
}

export function createPersonRig(look: PersonAppearance): PersonRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();

  const cloth = new THREE.MeshStandardMaterial({ color: look.cloth, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
  const limb = new THREE.MeshStandardMaterial({ color: look.limb, roughness: 0.8 });

  const add = (parent: THREE.Object3D, mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.85, 10), cloth), 0, 1.22, 0);
  add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.34, 0.25, 10), cloth), 0, 0.82, 0);
  add(body, new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin), 0, 1.86, 0);
  add(body, new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), hair), 0, 1.9, -0.05).scale.set(1, 0.9, 1.05);

  if (look.headwear === 'straw') {
    const straw = new THREE.MeshStandardMaterial({ color: look.headwearColor ?? 0xc2a65b, roughness: 0.9 });
    add(body, new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.22, 14), straw), 0, 2.1, 0);
  } else if (look.headwear === 'kerchief') {
    // 手ぬぐいを頭に巻いた形（後頭部を覆う半球）
    const cloth2 = new THREE.MeshStandardMaterial({ color: look.headwearColor ?? 0xe8e2d4, roughness: 0.85 });
    const cap = new THREE.SphereGeometry(0.265, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    add(body, new THREE.Mesh(cap, cloth2), 0, 1.9, -0.03).rotation.x = -0.25;
  }

  const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.75, 6).translate(0, -0.375, 0);
  for (const [leg, x] of [
    [leftLeg, 0.13],
    [rightLeg, -0.13],
  ] as const) {
    leg.position.set(x, 0.78, 0);
    add(leg, new THREE.Mesh(legGeo, limb), 0, 0, 0);
    body.add(leg);
  }
  const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6).translate(0, -0.35, 0);
  for (const [arm, x] of [
    [leftArm, 0.36],
    [rightArm, -0.36],
  ] as const) {
    arm.position.set(x, 1.58, 0);
    add(arm, new THREE.Mesh(armGeo, cloth), 0, 0, 0);
    body.add(arm);
  }
  root.add(body);
  root.scale.setScalar(look.height ?? 1);
  return { root, body, leftLeg, rightLeg, leftArm, rightArm };
}
