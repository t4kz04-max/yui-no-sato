import { el } from './dom';

/**
 * 住民の頭上の小さな名前（Phase 6.5）。少し離れた所から人を見つけやすくする。
 * 人にだけ出し、調べる物には出さない（未発見の調べる所を先回りして教えない）。
 */
export class NameTags {
  private readonly root: HTMLElement;
  private readonly tags = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'name-tags');
    parent.append(this.root);
  }

  /** 表示する名前と画面上の位置。ここにない人の名前は隠す。 */
  update(items: ReadonlyArray<{ readonly id: string; readonly name: string; readonly x: number; readonly y: number; readonly opacity: number }>): void {
    const shown = new Set<string>();
    for (const it of items) {
      let tag = this.tags.get(it.id);
      if (!tag) {
        tag = el('div', 'name-tag', it.name);
        tag.dataset.id = it.id;
        this.root.append(tag);
        this.tags.set(it.id, tag);
      }
      tag.hidden = false;
      tag.style.opacity = it.opacity.toFixed(2);
      tag.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -100%)`;
      shown.add(it.id);
    }
    for (const [id, tag] of this.tags) if (!shown.has(id)) tag.hidden = true;
  }
}
