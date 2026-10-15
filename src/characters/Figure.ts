import type * as THREE from 'three';
import { damp } from '../core/math';
import { applyFace, applyPose, createPersonRig, setHeldProp, type PersonAppearance, type PersonRig } from './personRig';
import { FaceAnimator } from './face';
import { addTalkGesture, blendPose, heldPropFor, idlePose, neutralPose, walkPose, type JointPose, type PoseStyle } from './poses';

/**
 * 人物モデルに姿勢を付けて動かす（住民・村の人たちで共通）。
 * 型（PoseStyle）が変わっても急に切り替わらないよう、今の姿勢から目標の姿勢へ滑らかに近づける。
 */
export class Figure {
  readonly rig: PersonRig;
  readonly root: THREE.Group;
  private style: PoseStyle;
  private time: number;
  private readonly pose: JointPose = neutralPose();
  private talk = 0;
  private attention = 0;
  private walkPhase = 0;
  /** まばたき・口・眉（Phase 6.5）。 */
  private readonly face: FaceAnimator;

  constructor(
    look: PersonAppearance,
    style: PoseStyle,
    private readonly seed = 0,
  ) {
    this.rig = createPersonRig(look);
    this.root = this.rig.root;
    this.style = style;
    // 全員が同じ拍子で動かないように、人ごとに時間をずらす
    this.time = seed * 2.3;
    this.face = new FaceAnimator(seed);
    setHeldProp(this.rig, heldPropFor(style));
    Object.assign(this.pose, idlePose(style, this.time, seed));
    applyPose(this.rig, this.pose);
  }

  get currentStyle(): PoseStyle {
    return this.style;
  }

  setStyle(style: PoseStyle): void {
    if (style === this.style) return;
    this.style = style;
    setHeldProp(this.rig, heldPropFor(style));
  }

  /**
   * @param talking 話している間（手振りとうなずきを付ける）
   * @param attending 相手と向き合っている間（よそ見をやめる）
   * @param walking 歩いているとき：速さの割合（0〜1）
   * @param speaking 声に出して話している間（口を動かす。文字送りの間）
   */
  update(dt: number, opts: { talking?: boolean; attending?: boolean; walking?: number; speaking?: boolean } = {}): void {
    this.time += dt;
    this.talk += ((opts.talking ? 1 : 0) - this.talk) * damp(5, dt);
    this.attention += ((opts.attending ? 1 : 0) - this.attention) * damp(4, dt);
    let target: JointPose;
    if (opts.walking !== undefined && opts.walking > 0.05) {
      this.walkPhase += dt * (4 + opts.walking * 5.5);
      target = walkPose(this.walkPhase, opts.walking, true, this.style === 'carry');
    } else {
      target = idlePose(this.style, this.time, this.seed);
      // 向き合っているときは、よそ見をしない
      target.headY *= 1 - this.attention;
      addTalkGesture(target, this.style, this.time, this.talk);
    }
    blendPose(this.pose, target, damp(10, dt));
    applyPose(this.rig, this.pose);
    applyFace(this.rig, this.face.update(dt, opts.speaking ?? false, opts.attending ?? false));
  }
}
