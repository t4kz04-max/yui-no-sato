import * as THREE from 'three';
import { damp } from '../core/math';
import {
  DEFAULT_ORBIT_LIMITS,
  DEFAULT_ORBIT_SETTINGS,
  applyOrbitInput,
  createOrbitState,
  orbitOffset,
  pickClearYaw,
  type OrbitInput,
  type OrbitLimits,
  type OrbitSettings,
  type OrbitState,
} from './orbit';

export interface CameraEnvironment {
  readonly blockers: readonly THREE.Object3D[];
  groundHeight(x: number, z: number): number;
}

/** 壁際で回り込む向きの候補（今の向きからのずれ）。 */
const AVOID_OFFSETS = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];

/**
 * 三人称追従カメラ。軌道計算は orbit.ts（純粋関数）に任せ、
 * ここでは注視点の追従と、建物・木によるカメラのめり込み防止だけを扱う。
 */
export class ThirdPersonCamera {
  readonly orbit: OrbitState;
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private effectiveDistance: number;
  private initialized = false;

  /** 注視点の高さ（プレイヤーの足元からの距離）。屋外は少し高めにして屋根まで入れる（Phase 6）。 */
  lookHeight = 2.3;
  /** 遮蔽物からカメラを離す余白。 */
  collisionPadding = 0.35;
  minCollisionDistance = 0.9;
  /** 上下角・距離の範囲（屋内では近め・低めにする。Phase 5.5）。 */
  limits: OrbitLimits = DEFAULT_ORBIT_LIMITS;
  /** 視点の感度など（設定画面で変わる）。 */
  settings: OrbitSettings = DEFAULT_ORBIT_SETTINGS;
  /** 壁際で遮られたら、横へ回り込んで主人公と進む先を見せる（室内。Phase 6）。 */
  avoidWalls = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly env: CameraEnvironment,
    initialYaw: number,
  ) {
    this.orbit = createOrbitState(initialYaw);
    this.effectiveDistance = this.orbit.distance;
  }

  update(focus: { x: number; y: number; z: number }, input: OrbitInput, dt: number): void {
    applyOrbitInput(this.orbit, input, dt, this.settings, this.limits);

    const goal = new THREE.Vector3(focus.x, focus.y + this.lookHeight, focus.z);
    if (!this.initialized) {
      this.target.copy(goal);
      this.initialized = true;
    } else {
      this.target.lerp(goal, damp(20, dt));
    }

    const offset = orbitOffset(this.orbit.yaw, this.orbit.pitch, this.orbit.distance);
    this.dir.set(offset.x, offset.y, offset.z).normalize();

    // 注視点からカメラ方向へレイを飛ばし、遮蔽物の手前で止める
    const allowed = this.freeDistance(this.dir);
    // 壁際：自分で視点を動かしていない間だけ、遮られない向きへゆっくり回り込む
    if (this.avoidWalls && input.lookX === 0 && allowed < this.orbit.distance * 0.75) {
      const candidates = AVOID_OFFSETS.map((offset) => {
        const o = orbitOffset(this.orbit.yaw + offset, this.orbit.pitch, this.orbit.distance);
        return { offset, free: this.freeDistance(this.probe.set(o.x, o.y, o.z).normalize()) };
      });
      const turn = pickClearYaw(allowed, candidates);
      if (turn !== 0) this.orbit.targetYaw += turn * damp(2.2, dt);
    }
    // 近づくときは即座に、離れるときは滑らかに（遮蔽物を抜けた瞬間に飛ばないように）
    if (allowed < this.effectiveDistance) this.effectiveDistance = allowed;
    else this.effectiveDistance += (allowed - this.effectiveDistance) * damp(6, dt);

    this.desired.copy(this.target).addScaledVector(this.dir, this.effectiveDistance);

    // 地面の下にカメラが潜らないようにする
    const minY = this.env.groundHeight(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < minY) this.desired.y = minY;

    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.target);
  }

  /** 注視点から dir の向きに、遮蔽物に当たらず離せる距離。 */
  private freeDistance(dir: THREE.Vector3): number {
    if (this.env.blockers.length === 0) return this.orbit.distance;
    this.raycaster.set(this.target, dir);
    this.raycaster.far = this.orbit.distance + this.collisionPadding;
    const hit = this.raycaster.intersectObjects(this.env.blockers as THREE.Object3D[], false)[0];
    return hit ? Math.max(this.minCollisionDistance, hit.distance - this.collisionPadding) : this.orbit.distance;
  }

  /** 記録の読込・やり直しのとき、補間せずに指定の向きへ置き直す。 */
  reset(yaw: number): void {
    this.orbit.yaw = this.orbit.targetYaw = yaw;
    this.initialized = false;
    this.effectiveDistance = this.orbit.distance;
  }

  /** 上下角と距離を、補間せずに置き直す。 */
  setFraming(pitch: number, distance: number): void {
    this.orbit.pitch = this.orbit.targetPitch = pitch;
    this.orbit.distance = this.orbit.targetDistance = distance;
    this.effectiveDistance = distance;
  }

  /** 遮蔽物を避けた、実際の注視点からの距離。 */
  get currentDistance(): number {
    return this.effectiveDistance;
  }

  /** 画面奥方向の水平角。移動入力の基準に使う。 */
  get yaw(): number {
    return this.orbit.yaw;
  }
}
