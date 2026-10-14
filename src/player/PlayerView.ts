import type * as THREE from 'three';
import { createPersonRig, type PersonAppearance, type PersonRig } from '../characters/personRig';
import { speedOf, type PlayerState } from './PlayerController';

const PLAYER_APPEARANCE: PersonAppearance = {
  cloth: 0x2c4a6f, // 藍染め風
  limb: 0x1e2d40,
  skin: 0xf2d3b6,
  hair: 0x1a1a1a,
  headwear: 'straw',
};

/**
 * プレイヤーの見た目（仮モデル）。人物モデルは住民と共通の personRig を使い、
 * 速度に応じた歩行アニメーションを付ける。状態（PlayerState）を読むだけで、書き換えない。
 */
export class PlayerView {
  readonly root: THREE.Group;
  private readonly rig: PersonRig;
  private phase = 0;

  constructor() {
    this.rig = createPersonRig(PLAYER_APPEARANCE);
    this.root = this.rig.root;
    this.root.name = 'player';
  }

  update(state: PlayerState, dt: number, runSpeed: number): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.heading;

    const speed = speedOf(state);
    const intensity = Math.min(1, speed / runSpeed);
    if (speed > 0.15) {
      this.phase += dt * (4 + speed * 1.6);
    } else {
      // 止まったら足を自然に揃える
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10);
    }
    const swing = Math.sin(this.phase) * (0.25 + intensity * 0.55) * (speed > 0.15 ? 1 : Math.min(1, speed * 6));
    this.rig.leftLeg.rotation.x = swing;
    this.rig.rightLeg.rotation.x = -swing;
    this.rig.leftArm.rotation.x = -swing * 0.7;
    this.rig.rightArm.rotation.x = swing * 0.7;
    this.rig.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * intensity;
  }
}
