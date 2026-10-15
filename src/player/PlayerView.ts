import * as THREE from 'three';
import { damp } from '../core/math';
import { applyFace, applyPose, createPersonRig, type PersonAppearance, type PersonRig } from '../characters/personRig';
import { FaceAnimator } from '../characters/face';
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
  /** 主人公だけ半透明にできるよう、人物共通の材質を複製して使う（Phase 6）。 */
  private material: THREE.MeshStandardMaterial | null = null;
  private phase = 0;
  private time = 0;
  private steps = 0;
  private lastStep = 0;
  /** まばたき（Phase 6.5。主人公は話す声を出さないので口は動かさない）。 */
  private readonly face = new FaceAnimator(0.37);

  constructor() {
    this.rig = createPersonRig(PLAYER_APPEARANCE);
    this.root = this.rig.root;
    this.root.name = 'player';
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        this.material ??= o.material.clone();
        o.material = this.material;
      }
    });
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
      // 足が地面に着くたび（歩行の周期の半分ごと）に足音の合図を数える
      const step = Math.floor(this.phase / Math.PI);
      if (step !== this.lastStep) this.steps++;
      this.lastStep = step;
    } else {
      // 止まったら足を自然に揃える
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 10);
      this.lastStep = Math.floor(this.phase / Math.PI);
    }
    const target = moving ? walkPose(this.phase, intensity, true) : idlePose('calm', this.time, 0);
    // 歩き出しはすぐに、止まるときは少しだけ滑らかに
    blendPose(this.pose, target, damp(moving ? 25 : 8, dt));
    applyPose(this.rig, this.pose);
    applyFace(this.rig, this.face.update(dt, false, false));
  }

  /** 前回から足が地面に着いた回数を取り出す（足音を鳴らす）。 */
  consumeSteps(): number {
    const n = this.steps;
    this.steps = 0;
    return n;
  }

  /** カメラがすぐ後ろまで寄ったときは半透明にする（消してしまうと位置が分からなくなる）。 */
  setOpacity(opacity: number): void {
    const m = this.material;
    this.root.visible = opacity > 0.05;
    if (!m) return;
    const transparent = opacity < 0.99;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.depthWrite = !transparent;
      m.needsUpdate = true;
    }
    m.opacity = transparent ? opacity : 1;
  }
}
