import { el } from './dom';

/**
 * 手帳の更新などを知らせる短い通知（右上の目的表示の下）。
 * 同時に出すのは最大3件。古いものから消える。
 */
const MAX_VISIBLE = 3;
const DURATION_MS = 3200;

export class Toasts {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts');
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
  }

  push(label: string, text: string): void {
    const t = el('div', 'toast');
    t.append(el('span', 'toast-label', label), el('span', 'toast-text', text));
    this.root.append(t);
    while (this.root.children.length > MAX_VISIBLE) this.root.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 400);
    }, DURATION_MS);
  }

  clear(): void {
    this.root.replaceChildren();
  }
}
