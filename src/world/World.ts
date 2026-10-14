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
import { createHarvestExtra, createKayaShed, createProp, createWorkshop } from './builders/structures';
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
  private readonly baseColliders: readonly Collider[];
  private npcColliders: readonly Collider[];
  private allColliders: readonly Collider[];
  /** 刈り入れが済んだときに、はさ掛けに足す稲の束。 */
  private harvestExtra: THREE.Object3D | null = null;
  readonly bounds: Bounds = WALK_BOUNDS;
  readonly locations: readonly LocationDef[] = LOCATIONS;
  /** カメラの壁抜け防止に使うメッシュ。 */
  readonly cameraBlockers: THREE.Object3D[] = [];
  /** サエ家の屋根の茅（葺き替えの前後で色を変えるため、他の家と共有しない）。 */
  private saeThatch: THREE.MeshStandardMaterial[] = [];
  private readonly freshThatch = new THREE.Color(0xb39a64);
  private readonly freshThatchEdge = new THREE.Color(0x9c8352);
  private oldThatch: THREE.Color[] = [];

  /** @param npcColliders 配置データ以外の障害物（住民の立ち位置）。 */
  constructor(npcColliders: readonly Collider[] = []) {
    this.root.name = 'world';
    this.baseColliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
    this.npcColliders = npcColliders;
    this.allColliders = [...this.baseColliders, ...npcColliders];
    this.build();
    this.root.updateMatrixWorld(true);
    this.root.traverse((obj) => {
      if (obj.userData.cameraBlocker) this.cameraBlockers.push(obj);
    });
  }

  get colliders(): readonly Collider[] {
    return this.allColliders;
  }

  /** 住民の立ち位置が変わったときに、当たり判定を差し替える。 */
  setNpcColliders(colliders: readonly Collider[]): void {
    this.npcColliders = colliders;
    this.allColliders = [...this.baseColliders, ...this.npcColliders];
  }

  /** 伊助家の刈り入れが済んだ見た目（はさ掛けに稲がすべて掛かる）にする。 */
  setHarvestDone(done: boolean): void {
    if (this.harvestExtra) this.harvestExtra.visible = done;
  }

  /** サエ家の屋根を、葺き替え前（古い茅）／葺き替え後（新しい茅）の見た目にする。 */
  setSaeRoofRenewed(renewed: boolean): void {
    this.saeThatch.forEach((m, i) => {
      m.color.copy(renewed ? (i === 0 ? this.freshThatchEdge : this.freshThatch) : this.oldThatch[i]!);
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
    // 結合の後に足す（表示を切り替えるため）
    this.harvestExtra = createHarvestExtra(p, PROPS.filter((prop) => prop.kind === 'hasaRack'));
    this.harvestExtra.visible = false;
    this.root.add(this.harvestExtra);
  }

  private createBuilding(p: ReturnType<typeof createPalette>, b: BuildingDef): THREE.Object3D {
    const obj =
      b.kind === 'gassho' ? createGasshoHouse(p) : b.kind === 'workshop' ? createWorkshop(p) : createKayaShed(p);
    obj.name = `building:${b.id}`;
    obj.position.set(b.position.x, terrainHeight(b.position.x, b.position.z), b.position.z);
    obj.rotation.y = b.rotation;
    obj.scale.setScalar(b.scale);
    if (b.location) obj.userData.location = b.location;
    if (b.id === 'sae') {
      // 屋根（複数マテリアルのメッシュ）の茅だけ専用のマテリアルにする
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh && Array.isArray(o.material)) {
          const own = (o.material as THREE.MeshStandardMaterial[]).map((m) => m.clone());
          o.material = own;
          this.saeThatch = own;
          this.oldThatch = own.map((m) => m.color.clone());
        }
      });
    }
    return obj;
  }
}
