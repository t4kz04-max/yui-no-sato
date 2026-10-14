import * as THREE from 'three';
import type { Bounds, Collider } from '../core/collision';
import type { WalkableWorld } from '../player/PlayerController';
import { buildCollisionMap } from './collisionMap';
import {
  BUILDINGS,
  LOCATIONS,
  MOUNTAINS,
  PATHS,
  PROPS,
  TREES,
  WALK_BOUNDS,
  type BuildingDef,
  type LocationDef,
} from './layout';
import { groundHeight, terrainHeight } from './terrain';
import { createPalette } from './builders/materials';
import { createGasshoHouse } from './builders/gassho';
import { createKayaShed, createProp, createWorkshop } from './builders/structures';
import {
  createBridge,
  createField,
  createMountains,
  createPaths,
  createTerrainMesh,
  createForest,
  createWaterway,
} from './builders/environment';
import { mergeStaticMeshes } from '../render/mergeStatic';

/**
 * 村の3D表現と、歩行に必要なデータ（当たり判定・地面の高さ）をまとめる。
 * 物語やゲーム状態は持たない。
 */
export class World implements WalkableWorld {
  readonly root = new THREE.Group();
  readonly colliders: readonly Collider[];
  readonly bounds: Bounds = WALK_BOUNDS;
  readonly locations: readonly LocationDef[] = LOCATIONS;
  /** カメラの壁抜け防止に使うメッシュ。 */
  readonly cameraBlockers: THREE.Object3D[] = [];

  /** @param extraColliders 配置データ以外の障害物（住民の立ち位置など）。 */
  constructor(extraColliders: readonly Collider[] = []) {
    this.root.name = 'world';
    this.colliders = [...buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES }), ...extraColliders];
    this.build();
    this.root.updateMatrixWorld(true);
    this.root.traverse((obj) => {
      if (obj.userData.cameraBlocker) this.cameraBlockers.push(obj);
    });
  }

  groundHeight(x: number, z: number): number {
    return groundHeight(x, z);
  }

  private build(): void {
    const p = createPalette();
    this.root.add(createTerrainMesh());
    this.root.add(createPaths(p, PATHS, { center: { x: 0, z: 15.5 }, radius: 5.5 }));
    this.root.add(createWaterway(p));
    this.root.add(createBridge(p));
    this.root.add(createField(p));
    this.root.add(createMountains(p, MOUNTAINS));

    for (const b of BUILDINGS) this.root.add(this.createBuilding(p, b));

    for (const prop of PROPS) {
      const obj = createProp(p, prop.kind);
      obj.position.set(prop.position.x, terrainHeight(prop.position.x, prop.position.z), prop.position.z);
      obj.rotation.y = prop.rotation;
      if (prop.scale) obj.scale.setScalar(prop.scale);
      this.root.add(obj);
    }

    this.root.add(createForest(p, TREES));
    mergeStaticMeshes(this.root);
  }

  private createBuilding(p: ReturnType<typeof createPalette>, b: BuildingDef): THREE.Object3D {
    const obj =
      b.kind === 'gassho' ? createGasshoHouse(p) : b.kind === 'workshop' ? createWorkshop(p) : createKayaShed(p);
    obj.name = `building:${b.id}`;
    obj.position.set(b.position.x, terrainHeight(b.position.x, b.position.z), b.position.z);
    obj.rotation.y = b.rotation;
    obj.scale.setScalar(b.scale);
    if (b.location) obj.userData.location = b.location;
    return obj;
  }
}
