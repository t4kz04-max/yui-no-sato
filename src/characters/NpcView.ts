import type * as THREE from 'three';
import { dampAngle, type Vec2 } from '../core/math';
import type { NpcInteractable } from '../interaction/types';
import { createPersonRig, type PersonAppearance, type PersonRig } from './personRig';

/**
 * 住民の見た目（仮モデル）。立ち位置は配置データのまま動かさず、
 * 会話中は相手の方を向き、終わると元の向きに戻る（設計書 L：会話中は相手がこちらを見る）。
 */
export class NpcView {
  readonly root: THREE.Group;
  private readonly rig: PersonRig;
  private heading: number;
  private time: number;

  constructor(
    readonly def: NpcInteractable,
    look: PersonAppearance,
    groundY: number,
  ) {
    this.rig = createPersonRig(look);
    this.root = this.rig.root;
    this.root.name = `npc:${def.id}`;
    this.root.position.set(def.position.x, groundY, def.position.z);
    this.heading = def.heading;
    this.root.rotation.y = this.heading;
    // 全員が同じ拍子で揺れないように、位置から位相をずらす
    this.time = def.position.x * 0.37 + def.position.z * 0.61;
  }

  /** lookAt が与えられている間はその方向を向く。talking のときは軽い身振りを付ける。 */
  update(dt: number, lookAt: Vec2 | null, talking: boolean): void {
    this.time += dt;
    const goal = lookAt ? Math.atan2(lookAt.x - this.def.position.x, lookAt.z - this.def.position.z) : this.def.heading;
    this.heading = dampAngle(this.heading, goal, 6, dt);
    this.root.rotation.y = this.heading;

    // 呼吸程度の上下動
    this.rig.body.position.y = Math.sin(this.time * 1.7) * 0.012;
    const gesture = talking ? -0.35 - Math.sin(this.time * 3.2) * 0.15 : 0;
    this.rig.rightArm.rotation.x += (gesture - this.rig.rightArm.rotation.x) * Math.min(1, dt * 6);
  }
}
