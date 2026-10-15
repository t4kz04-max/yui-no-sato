import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 動かない小さなメッシュ（柱・窓・薪など）を、マテリアルと影設定ごとに1つのメッシュへ結合する。
 * 合掌造りのように部品の多い建物でも描画呼び出し回数を抑えるため。
 *
 * 結合しないもの：カメラの遮蔽判定に使うメッシュ、表示を切り替えるメッシュ、複数マテリアルのメッシュ、InstancedMesh。
 */
export function mergeStaticMeshes(root: THREE.Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const merged: THREE.Mesh[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh) return;
    // 表示を切り替える物（userData.dynamic）は結合しない（Phase 6.5：屋根の乱れた茅など）
    if (obj.userData.cameraBlocker || obj.userData.dynamic || Array.isArray(obj.material)) return;
    const material = obj.material as THREE.Material;
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, obj.matrixWorld));
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const key = `${material.uuid}|${obj.castShadow}|${obj.receiveShadow}|${attrs}`;
    let group = groups.get(key);
    if (!group) {
      group = { material, cast: obj.castShadow, receive: obj.receiveShadow, geos: [] };
      groups.set(key, group);
    }
    group.geos.push(geo);
    merged.push(obj);
  });

  for (const mesh of merged) mesh.removeFromParent();

  for (const g of groups.values()) {
    const geometry = mergeGeometries(g.geos, false);
    for (const geo of g.geos) geo.dispose();
    if (!geometry) throw new Error('静的メッシュの結合に失敗しました');
    const mesh = new THREE.Mesh(geometry, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.name = 'merged-static';
    root.add(mesh);
  }
  return { before: merged.length, after: groups.size };
}
