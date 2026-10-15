import { el } from './dom';
import { ToastQueue, type ToastItem } from './toastQueue';

/**
 * 手帳の更新などを知らせる短い通知（右上の目的表示の下）。
 * 同時に出すのは最大2件。あふれた分は表示待ちに並べ、空いた枠へ順に出す（toastQueue.ts。レビュー指摘 2）。
 * 表示時間は実時間で数え（update を毎フレーム呼ぶ）、通知が隠れている間は止める。
 */
export class Toasts {
  private readonly root: HTMLElement;
  private readonly queue = new ToastQueue<ToastItem>(2, 3.2, 12);
  private readonly elements = new Map<ToastItem, HTMLElement>();
  /** 前回の更新の時刻（表示時間は実時間で数える）。 */
  private lastTime: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts');
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
  }

  push(label: string, text: string): void {
    this.queue.push({ label, text });
  }

  /**
   * 毎フレーム呼ぶ。hidden の間（画面を開いて通知が見えない間）は表示時間を進めない。
   * 表示時間は実時間で数える（描画が重くゲームの時間が遅れても、古い通知が長く残らない）。
   * タブを裏にした後などで時間が飛ばないよう、1 回に進めるのは 0.5 秒まで。
   */
  update(hidden: boolean, now: number = performance.now()): void {
    const dt = this.lastTime === null ? 0 : Math.min(0.5, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const { shown, expired } = this.queue.tick(dt, hidden);
    for (const item of expired) {
      const t = this.elements.get(item);
      this.elements.delete(item);
      if (!t) continue;
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 400);
    }
    for (const item of shown) {
      const t = el('div', 'toast');
      t.append(el('span', 'toast-label', item.label), el('span', 'toast-text', item.text));
      this.root.append(t);
      this.elements.set(item, t);
    }
  }

  /** 表示中と表示待ち（確認用）。 */
  get state(): { visible: readonly ToastItem[]; pending: readonly ToastItem[] } {
    return { visible: this.queue.visible, pending: this.queue.pending };
  }

  clear(): void {
    this.queue.clear();
    this.elements.clear();
    this.root.replaceChildren();
  }
}
