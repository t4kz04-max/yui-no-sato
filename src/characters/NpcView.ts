import type * as THREE from 'three';
import { dampAngle, type Vec2 } from '../core/math';
import type { NpcInteractable } from '../interaction/types';
import { Figure } from './Figure';
import type { PersonAppearance } from './personRig';
import type { PoseStyle } from './poses';

/**
 * 住民の見た目。普段は配置データの立ち位置にいる（章や結果によって setHome で移す）。
 * 待機中は人ごとの型（腕を組む・帳面を持つなど）で動き、会話中は相手の方を向いて手振りを付ける
 * （設計書 L：会話中は相手がこちらを見る）。
 */
export class NpcView {
  readonly root: THREE.Group;
  private readonly figure: Figure;
  private heading: number;
  /** 普段の立ち位置と向き（結果の後などで変わる）。 */
  private home: { x: number; z: number; heading: number };

  constructor(
    readonly def: NpcInteractable,
    look: PersonAppearance,
    groundY: number,
    style: PoseStyle = 'calm',
  ) {
    this.figure = new Figure(look, style, def.position.x * 0.37 + def.position.z * 0.61);
    this.root = this.figure.root;
    this.root.name = `npc:${def.id}`;
    this.root.position.set(def.position.x, groundY, def.position.z);
    this.home = { x: def.position.x, z: def.position.z, heading: def.heading };
    this.heading = def.heading;
    this.root.rotation.y = this.heading;
  }

  get style(): PoseStyle {
    return this.figure.currentStyle;
  }

  /** 立ち位置を変える（すぐにその場所へ移す）。 */
  setHome(x: number, z: number, heading: number, groundY: number): void {
    this.home = { x, z, heading };
    this.root.position.set(x, groundY, z);
    this.heading = heading;
    this.root.rotation.y = heading;
  }

  /** 立ち姿・作業の型を変える（章や当日の役割に合わせる）。 */
  setStyle(style: PoseStyle): void {
    this.figure.setStyle(style);
  }

  /** lookAt が与えられている間はその方向を向く。talking のときは手振りを付ける。 */
  update(dt: number, lookAt: Vec2 | null, talking: boolean): void {
    const goal = lookAt ? Math.atan2(lookAt.x - this.home.x, lookAt.z - this.home.z) : this.home.heading;
    this.heading = dampAngle(this.heading, goal, 6, dt);
    this.root.rotation.y = this.heading;
    this.figure.update(dt, { talking, attending: lookAt !== null, speaking: talking });
  }
}
