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
export type RoofState = 'old' | 'renewed' | 'partial' | 'worn';

const FRESH_THATCH = new THREE.Color(0xb39a64);
const FRESH_THATCH_EDGE = new THREE.Color(0x9c8352);
const WORN_THATCH = new THREE.Color(0x3e3428);

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
  /** 屋根の見た目を変えられる家（建物 ID → 茅のマテリアルと元の色）。他の家とは共有しない。 */
  private readonly roofs = new Map<string, { materials: THREE.MeshStandardMaterial[]; base: THREE.Color[] }>();

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

  /**
   * 屋根の見た目を変える。old＝元の茅／renewed＝葺き替えたばかり／partial＝一部だけ新しい（中間の色）／worn＝さらに傷んだ。
   */
  setRoofState(buildingId: string, state: RoofState): void {
    const roof = this.roofs.get(buildingId);
    if (!roof) return;
    roof.materials.forEach((m, i) => {
      const base = roof.base[i]!;
      const fresh = i === 0 ? FRESH_THATCH_EDGE : FRESH_THATCH;
      if (state === 'old') m.color.copy(base);
      else if (state === 'renewed') m.color.copy(fresh);
      else if (state === 'partial') m.color.copy(base).lerp(fresh, 0.5);
      else m.color.copy(base).lerp(WORN_THATCH, 0.45);
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
    if (b.id === 'sae' || b.id === 'isuke') {
      // 屋根（複数マテリアルのメッシュ）の茅だけ専用のマテリアルにする
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh && Array.isArray(o.material)) {
          const own = (o.material as THREE.MeshStandardMaterial[]).map((m) => m.clone());
          o.material = own;
          this.roofs.set(b.id, { materials: own, base: own.map((m) => m.color.clone()) });
        }
      });
    }
    return obj;
  }
}
