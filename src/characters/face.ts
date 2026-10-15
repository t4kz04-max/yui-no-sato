import { damp } from '../core/math';
import type { FaceState } from './personRig';

/**
 * 控えめな表情の動き（Phase 6.5）。Three.js に依存しない。
 * - まばたき：人ごとにずらした間隔（約 2.5〜5.5 秒）で、0.15 秒ほど目を閉じる。
 * - 話している間：口を小さく開け閉めする（文字送りの間だけ）。
 * - 相手の話を聞いている間：眉を少し上げる。
 */
export class FaceAnimator {
  private time: number;
  private nextBlink: number;
  private blinkTime = -1;
  private mouth = 0;
  private brow = 0;

  constructor(private readonly seed = 0) {
    this.time = seed * 1.7;
    this.nextBlink = this.time + 1 + (seed % 1) * 2;
  }

  /**
   * @param speaking 話している（文字送りの間）
   * @param listening 相手と向き合っている
   */
  update(dt: number, speaking: boolean, listening: boolean): FaceState {
    this.time += dt;
    if (this.blinkTime < 0 && this.time >= this.nextBlink) this.blinkTime = 0;
    let blink = 0;
    if (this.blinkTime >= 0) {
      this.blinkTime += dt;
      const t = this.blinkTime / 0.15;
      blink = t < 1 ? Math.sin(Math.PI * t) : 0;
      if (t >= 1) {
        this.blinkTime = -1;
        this.nextBlink = this.time + 2.5 + pseudo(this.seed + this.time) * 3;
      }
    }
    const talkMouth = speaking ? 0.35 + 0.35 * Math.max(0, Math.sin(this.time * 13 + this.seed)) * (0.6 + 0.4 * Math.sin(this.time * 3.1)) : 0;
    this.mouth += (talkMouth - this.mouth) * damp(speaking ? 25 : 10, dt);
    this.brow += ((listening && !speaking ? 1 : 0) - this.brow) * damp(4, dt);
    return { blink, mouth: Math.max(0, Math.min(1, this.mouth)), brow: this.brow };
  }
}

/** 0〜1 の決まった値（まばたきの間隔のばらつき）。 */
function pseudo(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
