import type { MoveIntent } from '../player/PlayerController';
import type { OrbitInput } from '../camera/orbit';

/**
 * キーボード・マウス入力を集約し、ゲームが使う抽象的な入力（移動意図・視点操作）に変換する。
 * ゲームロジックはキーコードを直接参照しない。
 *
 * 視点操作はマウスドラッグ方式（既存試作と同じ）。ポインターロックは、
 * Phase 1 以降の会話・手帳 UI のクリック操作と衝突しやすいため現時点では採用しない。
 */
export class InputManager {
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private dragPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  /** false の間は移動・視点入力を無視する（会話・調査中の操作制御）。キーの単発入力は引き続き記録する。 */
  enabled = true;

  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly target: HTMLElement,
    win: Window = window,
  ) {
    this.listen(win, 'keydown', (e) => this.onKey(e, true));
    this.listen(win, 'keyup', (e) => this.onKey(e, false));
    // ウィンドウからフォーカスが外れたらキーの押しっぱなしを解除
    this.listen(win, 'blur', () => this.reset());
    this.listen(target, 'pointerdown', (e) => this.onPointerDown(e));
    this.listen(target, 'pointermove', (e) => this.onPointerMove(e));
    this.listen(target, 'pointerup', (e) => this.onPointerUp(e));
    this.listen(target, 'pointercancel', (e) => this.onPointerUp(e));
    this.listen(target, 'wheel', (e) => this.onWheel(e), { passive: false });
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
  }

  /** このフレームで押されたか（押しっぱなしの自動リピートは含まない）。 */
  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** フレームの最後に呼び、単発入力の記録を消す。 */
  endFrame(): void {
    this.justPressed.clear();
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  getMoveIntent(): MoveIntent {
    if (!this.enabled) return { forward: 0, right: 0, run: false };
    const forward = (this.anyDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.anyDown('KeyS', 'ArrowDown') ? 1 : 0);
    const right = (this.anyDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.anyDown('KeyA', 'ArrowLeft') ? 1 : 0);
    return { forward, right, run: this.anyDown('ShiftLeft', 'ShiftRight') };
  }

  /** 前フレームからの視点操作量を取り出し、蓄積をリセットする。 */
  consumeOrbitInput(): OrbitInput {
    const input = this.enabled ? { lookX: this.lookX, lookY: this.lookY, zoom: this.zoom } : { lookX: 0, lookY: 0, zoom: 0 };
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    return input;
  }

  reset(): void {
    this.pressed.clear();
    this.justPressed.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.dragPointerId = null;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }

  private anyDown(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down) {
      if (!e.repeat) this.justPressed.add(e.code);
      this.pressed.add(e.code);
    } else {
      this.pressed.delete(e.code);
    }
    // 矢印キー・Space でのスクロールや F3（ブラウザの検索）を抑止する
    if (e.code.startsWith('Arrow') || e.code === 'F3' || e.code === 'Space') e.preventDefault();
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.dragPointerId !== null) return;
    this.dragPointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.target.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.dragPointerId) return;
    this.lookX += e.clientX - this.lastPointerX;
    this.lookY += e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    if (this.target.hasPointerCapture(e.pointerId)) this.target.releasePointerCapture(e.pointerId);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // deltaMode 1（行単位）の環境ではピクセル相当に換算する
    this.zoom += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  }

  private listen<K extends keyof WindowEventMap & keyof HTMLElementEventMap>(
    el: Window | HTMLElement,
    type: K,
    handler: (e: WindowEventMap[K] & HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const fn = handler as EventListener;
    el.addEventListener(type, fn, options);
    this.listeners.push(() => el.removeEventListener(type, fn, options));
  }
}
