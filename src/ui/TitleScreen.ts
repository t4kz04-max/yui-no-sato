import { el, overlayLayer, uiButton } from './dom';
import type { MenuItem } from './MenuPanel';

/**
 * タイトル画面とスタートメニュー（はじめから／つづきから／設定／史実と創作について）。
 * 背景は村の 3D 画面（Game がカメラをゆっくり回す）。キー操作は Game から moveSelection／activate を呼ぶ。
 */
export interface TitleContent {
  readonly items: readonly MenuItem[];
  readonly defaultId?: string;
  /** 前回の記録の情報（日時・章）や、記録を読めなかった知らせ。 */
  readonly status?: string;
}

export class TitleScreen {
  private readonly layer: HTMLDivElement;
  private readonly itemsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private content: TitleContent | null = null;
  private selected = 0;

  constructor(
    parent: HTMLElement,
    private readonly onActivate: (id: string) => void,
    private readonly onMove: () => void = () => undefined,
  ) {
    this.layer = overlayLayer('title-layer');
    const panel = el('div', 'title-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'タイトル');
    const logo = el('div', 'title-logo');
    logo.append(el('div', 'title-main', '結の約束'), el('div', 'title-ruby', 'ゆいのやくそく（仮）'));
    const lead = el('p', 'title-lead', '白川郷の「結」を題材にした、短い探索と相談の物語。\n村を歩いて住民の事情を知り、屋根葺きの段取りを一緒に考える。');
    this.itemsEl = el('div', 'title-items');
    this.statusEl = el('div', 'title-status');
    const controls = el('div', 'title-controls');
    for (const [k, v] of [
      ['W A S D', '歩く'],
      ['Shift', '走る'],
      ['ドラッグ', '見回す'],
      ['E', '話す・調べる'],
      ['Tab', '手帳'],
      ['Esc', 'ポーズ'],
    ]) {
      const row = el('span', 'title-control');
      row.append(el('kbd', undefined, k), el('span', undefined, v));
      controls.append(row);
    }
    panel.append(logo, lead, this.itemsEl, this.statusEl, controls, el('div', 'title-version', 'Beta 版（開発中）'));
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(content: TitleContent): void {
    this.content = content;
    const def = content.items.findIndex((i) => i.id === content.defaultId && !i.disabled);
    this.selected = def >= 0 ? def : Math.max(0, content.items.findIndex((i) => !i.disabled));
    this.statusEl.textContent = content.status ?? '';
    this.statusEl.hidden = !content.status;
    this.itemsEl.replaceChildren(
      ...content.items.map((item, i) => {
        const b = uiButton('title-item', item.label, () => this.activateIndex(i));
        b.dataset.id = item.id;
        b.disabled = item.disabled ?? false;
        b.addEventListener('pointerenter', () => {
          if (!item.disabled && this.selected !== i) {
            this.selected = i;
            this.renderSelection();
            this.onMove();
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
  }

  moveSelection(delta: number): void {
    const items = this.content?.items ?? [];
    if (items.length === 0) return;
    let i = this.selected;
    for (let n = 0; n < items.length; n++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i]!.disabled) break;
    }
    if (i !== this.selected) this.onMove();
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
    this.itemsEl.querySelectorAll('.title-item').forEach((b, i) => b.classList.toggle('is-selected', i === this.selected));
  }
}
