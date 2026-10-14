import * as THREE from 'three';
import { damp } from '../core/math';
import {
  applyOrbitInput,
  createOrbitState,
  orbitOffset,
  type OrbitInput,
  type OrbitState,
} from './orbit';

export interface CameraEnvironment {
  readonly blockers: readonly THREE.Object3D[];
  groundHeight(x: number, z: number): number;
}

/**
 * 三人称追従カメラ。軌道計算は orbit.ts（純粋関数）に任せ、
 * ここでは注視点の追従と、建物・木によるカメラのめり込み防止だけを扱う。
 */
export class ThirdPersonCamera {
  readonly orbit: OrbitState;
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private effectiveDistance: number;
  private initialized = false;

  /** 注視点の高さ（プレイヤーの足元からの距離）。 */
  lookHeight = 1.5;
  /** 遮蔽物からカメラを離す余白。 */
  collisionPadding = 0.35;
  minCollisionDistance = 0.9;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly env: CameraEnvironment,
    initialYaw: number,
  ) {
    this.orbit = createOrbitState(initialYaw);
    this.effectiveDistance = this.orbit.distance;
  }

  update(focus: { x: number; y: number; z: number }, input: OrbitInput, dt: number): void {
    applyOrbitInput(this.orbit, input, dt);

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
    let allowed = this.orbit.distance;
    if (this.env.blockers.length > 0) {
      this.raycaster.set(this.target, this.dir);
      this.raycaster.far = this.orbit.distance + this.collisionPadding;
      const hit = this.raycaster.intersectObjects(this.env.blockers as THREE.Object3D[], false)[0];
      if (hit) allowed = Math.max(this.minCollisionDistance, hit.distance - this.collisionPadding);
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

  /** 画面奥方向の水平角。移動入力の基準に使う。 */
  get yaw(): number {
    return this.orbit.yaw;
  }
}
