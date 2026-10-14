import * as THREE from 'three';
import type { Bounds, Collider } from '../core/collision';
import type { Vec2 } from '../core/math';
import type { WalkableWorld } from '../player/PlayerController';
import { buildCollisionMap } from './collisionMap';
import {
  BUILDINGS,
  LOCATIONS,
  MOUNTAIN_RANGES,
  PATHS,
  PROPS,
  TREES,
  WALK_BOUNDS,
  type BuildingDef,
  type LocationDef,
} from './layout';
import { groundHeight, terrainHeight } from './terrain';
import { createPalette, type Palette } from './builders/materials';
import { createGasshoHouse } from './builders/gassho';
import { createHarvestExtra, createKayaShed, createProp, createToolShed, createWorkshop } from './builders/structures';
import {
  createBridge,
  createField,
  createForest,
  createGrass,
  createMountainRanges,
  createPaddies,
  createPaths,
  createTerrainMesh,
  createWaterway,
} from './builders/environment';
import type { RoofState, ThatchRoof } from './builders/thatch';
import { mergeStaticMeshes } from '../render/mergeStatic';

export type { RoofState } from './builders/thatch';

export interface WorldOptions {
  /** 住民の立ち位置など、配置データ以外の障害物。 */
  readonly npcColliders?: readonly Collider[];
  /** 地平線の空の色と太陽の向き（遠景の山の色に使う）。 */
  readonly horizon?: THREE.Color;
  readonly sunDirection?: THREE.Vector3;
  /** 草むらで隠さない場所（調べられる物・住民の立ち位置）。 */
  readonly keepClear?: readonly Vec2[];
}

/**
 * 村の3D表現と、歩行に必要なデータ（当たり判定・地面の高さ）をまとめる。
 * 物語やゲーム状態は持たない（屋根の状態などは外から指示される）。
 */
export class World implements WalkableWorld {
  readonly root = new THREE.Group();
  readonly palette: Palette;
  private readonly baseColliders: readonly Collider[];
  private npcColliders: readonly Collider[];
  private extraColliders: readonly Collider[] = [];
  private allColliders: readonly Collider[];
  /** 刈り入れが済んだときに、はさ掛けに足す稲の束。 */
  private harvestExtra: THREE.Object3D | null = null;
  readonly bounds: Bounds = WALK_BOUNDS;
  readonly locations: readonly LocationDef[] = LOCATIONS;
  /** カメラの壁抜け防止に使うメッシュ。 */
  readonly cameraBlockers: THREE.Object3D[] = [];
  /** 屋根の見た目を変えられる家（建物 ID → 茅葺き屋根）。 */
  private readonly roofs = new Map<string, ThatchRoof>();
  /** 建物の置き場所（ID → 位置・向き・縮尺）。屋根葺きの日の足場などを家に合わせて置くために使う。 */
  readonly buildingRoots = new Map<string, THREE.Object3D>();

  constructor(options: WorldOptions = {}) {
    this.root.name = 'world';
    this.palette = createPalette();
    this.baseColliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
    this.npcColliders = options.npcColliders ?? [];
    this.allColliders = this.combineColliders();
    this.build(options);
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
    this.allColliders = this.combineColliders();
  }

  /** 章ごとに置く物（屋根葺きの日の茅の山・梯子など）の当たり判定。 */
  setExtraColliders(colliders: readonly Collider[]): void {
    this.extraColliders = colliders;
    this.allColliders = this.combineColliders();
  }

  private combineColliders(): readonly Collider[] {
    return [...this.baseColliders, ...this.npcColliders, ...this.extraColliders];
  }

  /** 伊助家の刈り入れが済んだ見た目（はさ掛けに稲がすべて掛かる）にする。 */
  setHarvestDone(done: boolean): void {
    if (this.harvestExtra) this.harvestExtra.visible = done;
  }

  /**
   * 屋根の見た目を変える。old＝ふつうの古さ（サエ家は南面に傷み）／renewed＝南面を葺き替えた／
   * partial＝傷んだ所だけ新しい／worn＝全体が傷んだ。
   */
  setRoofState(buildingId: string, state: RoofState): void {
    const roof = this.roofs.get(buildingId);
    if (roof && roof.state !== state) roof.setState(state);
  }

  roofState(buildingId: string): RoofState | undefined {
    return this.roofs.get(buildingId)?.state;
  }

  /** 物語に関わる家の茅葺き屋根（屋根葺きの日の足場を屋根に合わせて組むのに使う）。 */
  roofOf(buildingId: string): ThatchRoof | undefined {
    return this.roofs.get(buildingId);
  }

  groundHeight(x: number, z: number): number {
    return groundHeight(x, z);
  }

  private build(options: WorldOptions): void {
    const p = this.palette;
    this.root.add(createTerrainMesh(p, PATHS));
    this.root.add(createPaths(p, PATHS, { center: { x: 0, z: 15.5 }, radius: 5.5 }));
    this.root.add(createWaterway(p));
    this.root.add(createBridge(p));
    this.root.add(createField(p));
    this.root.add(createPaddies(p));
    this.root.add(
      createMountainRanges(
        MOUNTAIN_RANGES,
        options.horizon ?? new THREE.Color(0xe2e2d2),
        options.sunDirection ?? new THREE.Vector3(-0.6, 0.6, 0.5),
      ),
    );

    for (const b of BUILDINGS) this.root.add(this.createBuilding(p, b));

    for (const prop of PROPS) {
      const obj = createProp(p, prop.kind);
      obj.position.set(prop.position.x, terrainHeight(prop.position.x, prop.position.z), prop.position.z);
      obj.rotation.y = prop.rotation;
      if (prop.scale) obj.scale.setScalar(prop.scale);
      this.root.add(obj);
    }

    this.root.add(createForest(p, TREES));
    this.root.add(createGrass(p, { buildings: BUILDINGS, props: PROPS, paths: PATHS, keep: options.keepClear ?? [] }));
    mergeStaticMeshes(this.root);
    // 結合の後に足す（表示を切り替えるため）
    this.harvestExtra = createHarvestExtra(p, PROPS.filter((prop) => prop.tag === 'isukeHarvest'));
    this.harvestExtra.visible = false;
    this.root.add(this.harvestExtra);
  }

  private createBuilding(p: Palette, b: BuildingDef): THREE.Object3D {
    let obj: THREE.Object3D;
    if (b.kind === 'gassho') {
      const v = b.variant;
      const house = createGasshoHouse(p, {
        windowRows: v?.windowRows ?? 3,
        entrance: v?.entrance ?? 'gable',
        engawa: v?.engawa ?? false,
        leanKaya: v?.leanKaya ?? false,
        southSide: southSideOf(b.rotation),
        damage: v?.damage ?? null,
        seed: hashId(b.id),
      });
      obj = house.root;
      // 屋根は家ごとにジオメトリを持つ（状態の切り替えは物語に関わる家だけ）
      if (b.id === 'sae' || b.id === 'isuke') this.roofs.set(b.id, house.roof);
    } else if (b.kind === 'workshop') {
      obj = createWorkshop(p);
    } else if (b.kind === 'toolShed') {
      obj = createToolShed(p);
    } else {
      obj = createKayaShed(p);
    }
    obj.name = `building:${b.id}`;
    obj.position.set(b.position.x, terrainHeight(b.position.x, b.position.z), b.position.z);
    obj.rotation.y = b.rotation;
    obj.scale.setScalar(b.scale);
    if (b.location) obj.userData.location = b.location;
    this.buildingRoots.set(b.id, obj);
    return obj;
  }
}

/** 家の向き（rotation.y）から、南（+Z）を向いている屋根の面（ローカル ±X）を求める。 */
export function southSideOf(rotation: number): 1 | -1 {
  // ローカル +X は、ワールドでは (cos r, -sin r) の向きになる
  return -Math.sin(rotation) >= 0 ? 1 : -1;
}

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 1000;
}
