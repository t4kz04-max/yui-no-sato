import type { LedgerModel } from '../journal/models';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 結帳の専用画面（設計書 M 節：古い帳面をモチーフにした専用画面）。
 * 過去の記録（帳面の中身）と、今わかっていること・現在の意向（手帳より）を別の見た目で並べ、
 * 過去の協力と現在の同意を混同しないようにする。点数や合計は出さない。
 */
export class LedgerView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, title: string, note: string, handlers: { onClose(): void; onNotebook(): void }) {
    this.layer = overlayLayer('ledger-layer');
    const book = el('div', 'ledger');
    book.setAttribute('role', 'dialog');
    book.setAttribute('aria-label', title);
    const header = el('div', 'ledger-header');
    const actions = el('div', 'ledger-actions');
    actions.append(
      uiButton('panel-close is-ink', '手帳［Tab］', handlers.onNotebook),
      uiButton('panel-close is-ink', '閉じる［Esc］', handlers.onClose),
    );
    header.append(el('div', 'ledger-title', title), actions);
    this.bodyEl = el('div', 'ledger-body');
    book.append(header, this.bodyEl, el('div', 'ledger-note', `※ ${note}`));
    this.layer.append(book);
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer) handlers.onClose();
    });
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(model: LedgerModel): void {
    this.layer.hidden = false;
    const parts: HTMLElement[] = [];
    for (const entry of model.entries) {
      const sec = el('section', 'ledger-entry');
      sec.dataset.entry = entry.id;
      const head = el('div', 'ledger-entry-head');
      head.append(el('span', 'ledger-when', entry.when), el('span', 'ledger-entry-title', entry.title));
      sec.append(head);
      for (const item of entry.items) {
        const row = el('div', 'ledger-item');
        row.dataset.item = item.id;
        const line = el('div', 'ledger-item-line');
        line.append(
          el('span', 'ledger-who', `${item.from} → ${item.to}`),
          el('span', 'ledger-kind', item.kind),
          el('span', 'ledger-detail', item.detail),
        );
        const settle = el('div', `ledger-settle is-${item.settlement}`);
        settle.append(el('span', 'ledger-settle-chip', item.settlementLabel), el('span', undefined, item.settlementNote));
        row.append(line, settle);
        if (item.currentStance.length > 0) {
          const now = el('div', 'ledger-now');
          now.append(el('div', 'ledger-now-label', '今の意向（手帳より・この記録とは別）'));
          item.currentStance.forEach((s) => now.append(el('div', undefined, s)));
          row.append(now);
        }
        sec.append(row);
      }
      if (entry.related.length > 0) {
        // 詳しく読みたい人向け（開閉式）
        const now = el('details', 'ledger-now ledger-related');
        now.append(el('summary', 'ledger-now-label', `関連して今わかっていること（手帳より・${entry.related.length}）`));
        entry.related.forEach((r) => now.append(el('div', undefined, `${r.title}：${r.text}`)));
        sec.append(now);
      }
      parts.push(sec);
    }

    const promises = el('section', 'ledger-entry ledger-promises');
    promises.append(el('div', 'ledger-entry-head', 'これからの約束'));
    if (model.promises.length === 0) promises.append(el('div', 'ledger-empty', 'まだ新しい約束は記されていない。'));
    model.promises.forEach((p) => promises.append(el('div', 'ledger-item', `${p.from} → ${p.to}：${p.content}${p.kept ? '（果たした）' : ''}`)));
    parts.push(promises);

    this.bodyEl.replaceChildren(...parts);
    this.bodyEl.scrollTop = 0;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}
