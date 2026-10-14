import type * as THREE from 'three';
import { damp } from '../core/math';
import { applyPose, createPersonRig, type PersonAppearance, type PersonRig } from '../characters/personRig';
import { blendPose, idlePose, neutralPose, walkPose } from '../characters/poses';
import { speedOf, type PlayerState } from './PlayerController';

/** 主人公：藍の上着、笠、肩掛けの袋（手帳を入れている）。docs/PHASE5_ART.md §3。 */
export const PLAYER_APPEARANCE: PersonAppearance = {
  cloth: 0x2c4a72,
  limb: 0x1e2a3a,
  skin: 0xf2d3b6,
  hair: 0x1a1a1a,
  headwear: 'straw',
  headwearColor: 0xcdb066,
  sash: 0x8a6a48,
  collar: 0xd8d2c0,
  pack: 'bag',
  leggings: 0xd8d2c0,
};

/**
 * プレイヤーの見た目。速度に応じた歩行・走行と、止まっているときの待機の動きを付ける。
 * 状態（PlayerState）を読むだけで、書き換えない。
 */
export class PlayerView {
  readonly root: THREE.Group;
  private readonly rig: PersonRig;
  private readonly pose = neutralPose();
  private phase = 0;
  private time = 0;

  constructor() {
    this.rig = createPersonRig(PLAYER_APPEARANCE);
    this.root = this.rig.root;
    this.root.name = 'player';
  }

  update(state: PlayerState, dt: number, runSpeed: number): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.heading;
    this.time += dt;

    const speed = speedOf(state);
    const intensity = Math.min(1, speed / runSpeed);
    const moving = speed > 0.15;
    if (moving) {
      this.phase += dt * (4 + speed * 1.6);
    } else {
      // 止まったら足を自然に揃える
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10);
    }
    const target = moving ? walkPose(this.phase, intensity, true) : idlePose('calm', this.time, 0);
    // 歩き出しはすぐに、止まるときは少しだけ滑らかに
    blendPose(this.pose, target, damp(moving ? 25 : 8, dt));
    applyPose(this.rig, this.pose);
  }
}
