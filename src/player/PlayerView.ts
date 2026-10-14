import * as THREE from 'three';
import { speedOf, type PlayerState } from './PlayerController';

/**
 * プレイヤーの見た目（仮モデル）。既存試作の笠をかぶった人物を移植し、
 * 足を股関節で回転させる構造と、速度に応じた歩行アニメーションに改めた。
 * 状態（PlayerState）を読むだけで、書き換えない。
 */
export class PlayerView {
  readonly root = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly body = new THREE.Group();
  private phase = 0;

  constructor() {
    this.root.name = 'player';
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2c4a6f, roughness: 0.8 }); // 藍染め風
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2d3b6, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const straw = new THREE.MeshStandardMaterial({ color: 0xc2a65b, roughness: 0.9 });
    const limb = new THREE.MeshStandardMaterial({ color: 0x1e2d40, roughness: 0.8 });

    const add = (parent: THREE.Object3D, mesh: THREE.Mesh, x: number, y: number, z: number) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    add(this.body, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.85, 10), cloth), 0, 1.22, 0);
    add(this.body, new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.34, 0.25, 10), cloth), 0, 0.82, 0);
    add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin), 0, 1.86, 0);
    add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), hair), 0, 1.9, -0.05).scale.set(1, 0.9, 1.05);
    add(this.body, new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.22, 14), straw), 0, 2.1, 0);

    const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.75, 6).translate(0, -0.375, 0);
    for (const [leg, x] of [
      [this.leftLeg, 0.13],
      [this.rightLeg, -0.13],
    ] as const) {
      leg.position.set(x, 0.78, 0);
      add(leg, new THREE.Mesh(legGeo, limb), 0, 0, 0);
      this.body.add(leg);
    }
    const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6).translate(0, -0.35, 0);
    for (const [arm, x] of [
      [this.leftArm, 0.36],
      [this.rightArm, -0.36],
    ] as const) {
      arm.position.set(x, 1.58, 0);
      add(arm, new THREE.Mesh(armGeo, cloth), 0, 0, 0);
      this.body.add(arm);
    }
    this.root.add(this.body);
  }

  update(state: PlayerState, dt: number, runSpeed: number): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.heading;

    const speed = speedOf(state);
    const intensity = Math.min(1, speed / runSpeed) ;
    if (speed > 0.15) {
      this.phase += dt * (4 + speed * 1.6);
    } else {
      // 止まったら足を自然に揃える
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10);
    }
    const swing = Math.sin(this.phase) * (0.25 + intensity * 0.55) * (speed > 0.15 ? 1 : Math.min(1, speed * 6));
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.7;
    this.rightArm.rotation.x = swing * 0.7;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * intensity;
  }
}
