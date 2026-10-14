import { el, overlayLayer, uiButton } from './dom';

/**
 * 物語の区切りの画面：エンディング（振り返り付き）と、史実と創作の解説。
 * 表示だけを担当し、内容は Game が組み立てて渡す。
 */
export interface EndingModel {
  readonly code: string;
  readonly title: string;
  readonly story: readonly string[];
  readonly choices: ReadonlyArray<{ readonly label: string; readonly text: string }>;
  readonly records: readonly string[];
}

export class EndingView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, handlers: { onClose(): void; onExplain(): void }) {
    this.layer = overlayLayer('ending-layer');
    const panel = el('div', 'result panel-paper ending');
    panel.setAttribute('role', 'dialog');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'paper-footer');
    footer.append(
      uiButton('plan-pick', '史実と創作について', handlers.onExplain),
      uiButton('plan-decide', '村に戻る［Enter］', handlers.onClose),
    );
    panel.append(this.bodyEl, footer);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(m: EndingModel): void {
    const head = el('div', 'result-head');
    head.append(el('div', 'result-when', `エンディング ${m.code}`), el('h2', 'result-title', m.title));
    const story = el('div', 'result-story');
    m.story.forEach((t) => story.append(el('p', undefined, t)));

    const choices = el('section', 'result-block is-decided');
    choices.append(el('h3', 'result-block-title', 'あなたが決めたこと'));
    const dl = el('dl', 'forecast');
    m.choices.forEach((c) => dl.append(el('dt', undefined, c.label), el('dd', undefined, c.text)));
    choices.append(dl);

    const records = el('section', 'result-block is-achieved');
    records.append(el('h3', 'result-block-title', '結帳に残ったこと'));
    const ul = el('ul');
    m.records.forEach((r) => ul.append(el('li', undefined, r)));
    records.append(ul);

    this.bodyEl.replaceChildren(head, story, choices, records);
    this.bodyEl.scrollTop = 0;
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}

export interface ExplainModel {
  readonly title: string;
  readonly history: { readonly heading: string; readonly items: readonly string[] };
  readonly fiction: { readonly heading: string; readonly items: readonly string[] };
  readonly notes: readonly string[];
}

export class ExplainView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.layer = overlayLayer('explain-layer');
    const panel = el('div', 'result panel-paper explain');
    panel.setAttribute('role', 'dialog');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'paper-footer');
    footer.append(uiButton('plan-decide', '閉じる［Esc］', onClose));
    panel.append(this.bodyEl, footer);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(m: ExplainModel): void {
    const block = (heading: string, items: readonly string[], cls: string) => {
      const s = el('section', `result-block ${cls}`);
      s.append(el('h3', 'result-block-title', heading));
      const ul = el('ul');
      items.forEach((t) => ul.append(el('li', undefined, t)));
      s.append(ul);
      return s;
    };
    const notes = el('div', 'result-note explain-notes');
    m.notes.forEach((n) => notes.append(el('p', undefined, `※ ${n}`)));
    this.bodyEl.replaceChildren(
      el('h2', 'result-title', m.title),
      block(m.history.heading, m.history.items, 'is-decided'),
      block(m.fiction.heading, m.fiction.items, 'is-other'),
      notes,
    );
    this.bodyEl.scrollTop = 0;
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}
