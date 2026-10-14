import type { NotebookModel, NotebookPerson, NotebookTopic } from '../journal/models';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 手帳（Tab）。「人物」「分かったこと」「未確認」「約束」の4区分（設計書 F 節）。
 * 表示だけを担当し、内容は journal/models.ts の buildNotebook が作る。
 */
export type NotebookTab = 'people' | 'known' | 'unconfirmed' | 'promises';

const TABS: ReadonlyArray<{ id: NotebookTab; label: string }> = [
  { id: 'people', label: '人物' },
  { id: 'known', label: '分かったこと' },
  { id: 'unconfirmed', label: '未確認' },
  { id: 'promises', label: '約束' },
];

export class NotebookView {
  private readonly layer: HTMLDivElement;
  private readonly tabsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private model: NotebookModel | null = null;
  /** この順番より新しい記録に「新」を付ける。 */
  private seenOrder = 0;
  private tab: NotebookTab = 'known';

  constructor(parent: HTMLElement, onClose: () => void) {
    this.layer = overlayLayer('notebook-layer');
    const panel = el('div', 'notebook');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '手帳');
    const header = el('div', 'notebook-header');
    header.append(el('div', 'notebook-title', '手帳'), uiButton('panel-close', '閉じる［Tab］', onClose));
    this.tabsEl = el('div', 'notebook-tabs');
    this.bodyEl = el('div', 'notebook-body');
    panel.append(header, this.tabsEl, this.bodyEl);
    this.layer.append(panel);
    // パネルの外側をクリックしたら閉じる
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer) onClose();
    });
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  get currentTab(): NotebookTab {
    return this.tab;
  }

  show(model: NotebookModel, seenOrder: number): void {
    this.model = model;
    this.seenOrder = seenOrder;
    this.layer.hidden = false;
    this.render();
  }

  hide(): void {
    this.layer.hidden = true;
  }

  setTab(tab: NotebookTab): void {
    this.tab = tab;
    if (this.visible) this.render();
  }

  moveTab(delta: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + delta + TABS.length) % TABS.length]!.id);
  }

  private render(): void {
    const m = this.model;
    if (!m) return;
    const counts: Record<NotebookTab, number> = {
      people: m.people.length,
      known: m.known.length,
      unconfirmed: m.unconfirmed.length,
      promises: m.promises.length,
    };
    const hasNew: Record<NotebookTab, boolean> = {
      people: m.people.some((p) => p.topics.some((t) => this.isNew(t))),
      known: m.known.some((t) => this.isNew(t)),
      unconfirmed: m.unconfirmed.some((t) => this.isNew(t)),
      promises: false,
    };
    this.tabsEl.replaceChildren(
      ...TABS.map((t) => {
        const b = uiButton(`notebook-tab${t.id === this.tab ? ' is-active' : ''}`, `${t.label}（${counts[t.id]}）`, () =>
          this.setTab(t.id),
        );
        b.dataset.tab = t.id;
        if (hasNew[t.id]) b.append(el('span', 'badge-new', '新'));
        return b;
      }),
    );

    const body: HTMLElement[] = [];
    switch (this.tab) {
      case 'people':
        if (m.people.length === 0) body.push(empty('まだ誰とも話していない。'));
        m.people.forEach((p) => body.push(this.personCard(p)));
        break;
      case 'known':
        if (m.known.length === 0) body.push(empty('まだ何も分かっていない。'));
        m.known.forEach((t) => body.push(this.topicItem(t, true)));
        break;
      case 'unconfirmed':
        body.push(el('p', 'notebook-hint', '聞いただけで、理由や事情をまだ確かめていないこと。'));
        if (m.unconfirmed.length === 0) body.push(empty('確かめるべきことは、今のところない。'));
        m.unconfirmed.forEach((t) => body.push(this.topicItem(t, true)));
        break;
      case 'promises':
        body.push(el('p', 'notebook-hint', 'これから果たす約束。計画を相談し、相手が承諾したときに記される。'));
        if (m.promises.length === 0) body.push(empty('まだ約束はない。'));
        m.promises.forEach((p) => {
          const item = el('div', 'notebook-item');
          const title = el('div', 'notebook-item-title', `${p.from} → ${p.to}`);
          if (p.kept) title.append(el('span', 'badge-new', '果たした'));
          item.append(title, el('div', 'notebook-item-summary', p.content));
          body.push(item);
        });
        break;
    }
    this.bodyEl.replaceChildren(...body);
    this.bodyEl.scrollTop = 0;
  }

  private isNew(t: NotebookTopic): boolean {
    return t.order > this.seenOrder;
  }

  private topicItem(t: NotebookTopic, showPerson: boolean): HTMLElement {
    const item = el('div', `notebook-item is-${t.category}`);
    item.dataset.topic = t.topic;
    // 1 見出し → 2 要点（大きく） → 3 全文 → 4 入手元とこれまでの記録（開閉式）
    const title = el('div', 'notebook-item-title', showPerson && t.personName ? `${t.personName}｜${t.title}` : t.title);
    if (this.isNew(t)) title.append(el('span', 'badge-new', t.history.length > 0 ? '更新' : '新'));
    item.append(title, el('div', 'notebook-item-summary', t.summary), el('div', 'notebook-item-text', t.text));
    if (t.source || t.history.length > 0) {
      const details = el('details', 'notebook-history');
      details.append(el('summary', undefined, t.history.length > 0 ? `どこで知ったか・これまでの記録（${t.history.length}）` : 'どこで知ったか'));
      if (t.source) details.append(el('div', 'notebook-item-source', `いまの記述：${t.source}`));
      const list = el('ol');
      t.history.forEach((h) => {
        const li = el('li', `is-${h.category}`);
        li.append(el('div', 'notebook-history-summary', h.summary), el('div', 'notebook-history-text', h.text));
        if (h.source) li.append(el('span', 'notebook-item-source', `（${h.source}）`));
        list.append(li);
      });
      details.append(list);
      item.append(details);
    }
    return item;
  }

  private personCard(p: NotebookPerson): HTMLElement {
    const card = el('div', 'notebook-person');
    card.dataset.person = p.id;
    const head = el('div', 'notebook-person-head');
    head.append(el('span', 'notebook-person-name', p.name), el('span', 'notebook-person-role', p.role));
    card.append(head);

    const stance = el('div', 'notebook-stance');
    stance.append(el('div', 'notebook-subhead', '今の意向'));
    if (p.consents.length === 0) stance.append(el('div', 'notebook-muted', 'まだ聞いていない。'));
    p.consents.forEach((c) => {
      const line = el('div', 'notebook-stance-line');
      line.append(el('span', 'notebook-stance-request', c.request), el('span', `stance-chip is-${c.statusKey}`, c.status));
      if (c.note) line.append(el('span', 'notebook-muted', `（${c.note}）`));
      if (c.history.length > 0) line.append(el('span', 'notebook-muted', ` 以前：${c.history.join(' → ')}`));
      stance.append(line);
    });
    if (p.plan) {
      const line = el('div', 'notebook-stance-line');
      line.append(el('span', 'notebook-stance-request', '今の計画案への返事'), el('span', 'stance-chip', p.plan.status));
      if (p.plan.summary) line.append(el('span', 'notebook-muted', `（${p.plan.summary}）`));
      stance.append(line);
    }
    card.append(stance);

    const facts = el('div', 'notebook-person-topics');
    facts.append(el('div', 'notebook-subhead', '分かっていること・未確認'));
    if (p.topics.length === 0) facts.append(el('div', 'notebook-muted', 'まだ何も記していない。'));
    p.topics.forEach((t) => facts.append(this.topicItem(t, false)));
    card.append(facts);
    return card;
  }
}

function empty(text: string): HTMLElement {
  return el('p', 'notebook-empty', text);
}
