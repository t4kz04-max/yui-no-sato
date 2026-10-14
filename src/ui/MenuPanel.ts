import { el, overlayLayer, uiButton } from './dom';

/**
 * ボタンを縦に並べた小さな画面（ポーズメニュー、確認・お知らせ）。
 * キー操作（↑↓・決定）はゲーム側から moveSelection／activate を呼ぶ。
 */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface MenuContent {
  readonly title: string;
  readonly body?: string;
  readonly items: readonly MenuItem[];
  /** 下に小さく出す状態表示（例：「記録しました」）。 */
  readonly status?: string;
  /** 最初に選ばれている項目（安全な方を既定にする）。 */
  readonly defaultId?: string;
}

export class MenuPanel {
  private readonly layer: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly itemsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private content: MenuContent | null = null;
  private selected = 0;

  constructor(
    parent: HTMLElement,
    className: string,
    private readonly onActivate: (id: string) => void,
  ) {
    this.layer = overlayLayer(`menu-layer ${className}`);
    const panel = el('div', 'menu-panel');
    panel.setAttribute('role', 'dialog');
    this.titleEl = el('div', 'menu-title');
    this.bodyEl = el('div', 'menu-body');
    this.itemsEl = el('div', 'menu-items');
    this.statusEl = el('div', 'menu-status');
    panel.append(this.titleEl, this.bodyEl, this.itemsEl, this.statusEl);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(content: MenuContent): void {
    this.content = content;
    const def = content.items.findIndex((i) => i.id === content.defaultId && !i.disabled);
    this.selected = def >= 0 ? def : Math.max(0, content.items.findIndex((i) => !i.disabled));
    this.titleEl.textContent = content.title;
    this.bodyEl.textContent = content.body ?? '';
    this.bodyEl.hidden = !content.body;
    this.setStatus(content.status ?? '');
    this.itemsEl.replaceChildren(
      ...content.items.map((item, i) => {
        const b = uiButton('menu-item', item.label, () => this.activateIndex(i));
        b.dataset.id = item.id;
        b.disabled = item.disabled ?? false;
        b.addEventListener('pointerenter', () => {
          if (!item.disabled) {
            this.selected = i;
            this.renderSelection();
          }
        });
        return b;
      }),
    );
    this.renderSelection();
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
    this.content = null;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.hidden = text === '';
  }

  moveSelection(delta: number): void {
    const items = this.content?.items ?? [];
    if (items.length === 0) return;
    let i = this.selected;
    for (let n = 0; n < items.length; n++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i]!.disabled) break;
    }
    this.selected = i;
    this.renderSelection();
  }

  activate(): void {
    this.activateIndex(this.selected);
  }

  private activateIndex(i: number): void {
    const item = this.content?.items[i];
    if (!item || item.disabled) return;
    this.onActivate(item.id);
  }

  private renderSelection(): void {
    this.itemsEl.querySelectorAll('.menu-item').forEach((b, i) => b.classList.toggle('is-selected', i === this.selected));
  }
}
