import type * as THREE from 'three';
import { dampAngle, type Vec2 } from '../core/math';
import type { NpcInteractable } from '../interaction/types';
import { createPersonRig, type PersonAppearance, type PersonRig } from './personRig';

/**
 * 住民の見た目（仮モデル）。普段は配置データの立ち位置にいる（結果の後などは setHome で移す）。
 * 会話中は相手の方を向き、終わると元の向きに戻る（設計書 L：会話中は相手がこちらを見る）。
 */
export class NpcView {
  readonly root: THREE.Group;
  private readonly rig: PersonRig;
  private heading: number;
  private time: number;
  /** 普段の立ち位置と向き（結果の後などで変わる）。 */
  private home: { x: number; z: number; heading: number };

  constructor(
    readonly def: NpcInteractable,
    look: PersonAppearance,
    groundY: number,
  ) {
    this.rig = createPersonRig(look);
    this.root = this.rig.root;
    this.root.name = `npc:${def.id}`;
    this.root.position.set(def.position.x, groundY, def.position.z);
    this.home = { x: def.position.x, z: def.position.z, heading: def.heading };
    this.heading = def.heading;
    this.root.rotation.y = this.heading;
    // 全員が同じ拍子で揺れないように、位置から位相をずらす
    this.time = def.position.x * 0.37 + def.position.z * 0.61;
  }

  /** 立ち位置を変える（すぐにその場所へ移す）。 */
  setHome(x: number, z: number, heading: number, groundY: number): void {
    this.home = { x, z, heading };
    this.root.position.set(x, groundY, z);
    this.heading = heading;
    this.root.rotation.y = heading;
  }

  /** lookAt が与えられている間はその方向を向く。talking のときは軽い身振りを付ける。 */
  update(dt: number, lookAt: Vec2 | null, talking: boolean): void {
    this.time += dt;
    const goal = lookAt ? Math.atan2(lookAt.x - this.home.x, lookAt.z - this.home.z) : this.home.heading;
    this.heading = dampAngle(this.heading, goal, 6, dt);
    this.root.rotation.y = this.heading;

    // 呼吸程度の上下動
    this.rig.body.position.y = Math.sin(this.time * 1.7) * 0.012;
    const gesture = talking ? -0.35 - Math.sin(this.time * 3.2) * 0.15 : 0;
    this.rig.rightArm.rotation.x += (gesture - this.rig.rightArm.rotation.x) * Math.min(1, dt * 6);
  }
}
