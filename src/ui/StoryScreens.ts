import type { ExplainContent } from '../content/chronicle';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 物語の区切りの画面：エンディング（振り返り付き）と、史実と創作の解説。
 * 表示だけを担当し、内容は Game が組み立てて渡す。
 */
export interface EndingModel {
  readonly code: string;
  readonly title: string;
  readonly story: readonly string[];
  /** 実現したこと・残ったこと（点数にはしない）。 */
  readonly achieved: readonly string[];
  readonly remains: readonly string[];
  readonly choices: ReadonlyArray<{ readonly label: string; readonly text: string }>;
  readonly records: readonly string[];
  readonly promises: ReadonlyArray<{ readonly text: string; readonly kept: boolean }>;
}

export class EndingView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, handlers: { onClose(): void; onExplain(): void; onHistory(): void }) {
    this.layer = overlayLayer('ending-layer');
    const panel = el('div', 'result panel-paper ending');
    panel.setAttribute('role', 'dialog');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'paper-footer');
    const action = (b: HTMLButtonElement, id: string) => {
      b.dataset.action = id;
      return b;
    };
    footer.append(
      action(uiButton('plan-pick', '選んだことの記録', handlers.onHistory), 'history'),
      action(uiButton('plan-pick', '史実と創作について', handlers.onExplain), 'explain'),
      action(uiButton('plan-decide', '村に戻る［Enter］', handlers.onClose), 'close'),
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

    const cols = el('div', 'result-columns');
    const achieved = el('section', 'result-block is-achieved');
    achieved.append(el('h3', 'result-block-title', '実現したこと'), list(m.achieved));
    const remains = el('section', 'result-block is-costs');
    remains.append(el('h3', 'result-block-title', '残ったこと・これから'), list(m.remains));
    cols.append(achieved, remains);

    const choices = el('section', 'result-block is-decided');
    choices.append(el('h3', 'result-block-title', 'あなたが決めたこと'));
    const dl = el('dl', 'forecast');
    m.choices.forEach((c) => dl.append(el('dt', undefined, c.label), el('dd', undefined, c.text)));
    choices.append(dl);

    const parts: HTMLElement[] = [head, story, cols, choices];
    if (m.promises.length > 0) {
      const promises = el('section', 'result-block is-other');
      promises.append(el('h3', 'result-block-title', '約束のゆくえ'));
      const ul = el('ul');
      m.promises.forEach((p) => {
        const li = el('li', undefined, p.text);
        li.append(el('span', `history-promise${p.kept ? ' is-kept' : ''}`, p.kept ? '果たした' : 'まだ'));
        ul.append(li);
      });
      promises.append(ul);
      parts.push(promises);
    }
    if (m.records.length > 0) {
      const records = el('details', 'result-block ending-records');
      records.append(el('summary', 'result-block-title', `結帳に書き加えられたこと（${m.records.length}）`), list(m.records));
      parts.push(records);
    }
    this.bodyEl.replaceChildren(...parts);
    this.bodyEl.scrollTop = 0;
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}

/** 区分ごとの見た目（事実・確認中・単純化・架空・設定）。 */
const SECTION_CLASS: Record<ExplainContent['sections'][number]['id'], string> = {
  facts: 'is-decided',
  pending: 'is-pending',
  simplified: 'is-other',
  people: 'is-costs',
  settings: 'is-costs',
};

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

  show(m: ExplainContent): void {
    const parts: HTMLElement[] = [el('h2', 'result-title', m.title), el('p', 'result-story explain-intro', m.intro)];
    for (const s of m.sections) {
      const sec = el('section', `result-block ${SECTION_CLASS[s.id]}`);
      sec.dataset.section = s.id;
      sec.append(el('h3', 'result-block-title', s.heading), el('p', 'explain-lead', s.lead), list(s.items));
      parts.push(sec);
    }
    const src = el('section', 'result-note explain-notes');
    src.append(el('div', 'explain-sources-title', '出典'));
    const ul = el('ul');
    m.sources.forEach((s) => ul.append(el('li', undefined, `${s.title}　${s.url}`)));
    src.append(ul);
    m.notes.forEach((n) => src.append(el('p', undefined, `※ ${n}`)));
    parts.push(src);
    this.bodyEl.replaceChildren(...parts);
    this.bodyEl.scrollTop = 0;
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}

function list(items: readonly string[]): HTMLElement {
  const ul = el('ul');
  items.forEach((t) => ul.append(el('li', undefined, t)));
  return ul;
}
