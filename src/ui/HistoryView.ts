import type { HistoryModel } from '../journal/historyModel';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 「選んだことの記録」（選択履歴）。決めた計画ごとに、選んだこと → 誰が承知したか → 結果を並べる。
 * 要点（選んだこと・結果）を先に、相談の経過・決めたときに分かっていたことは開閉式にする。
 */
export class HistoryView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.layer = overlayLayer('history-layer');
    const panel = el('div', 'result panel-paper history');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '選んだことの記録');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'paper-footer');
    footer.append(el('div', 'plan-foot-note', '良し悪しではなく、何を選び、何が変わったかの記録。'), uiButton('plan-decide', '閉じる［Esc］', onClose));
    panel.append(this.bodyEl, footer);
    this.layer.append(panel);
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer) onClose();
    });
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(m: HistoryModel): void {
    const parts: HTMLElement[] = [el('h2', 'result-title', '選んだことの記録')];
    if (m.acts.length === 0) parts.push(el('p', 'notebook-empty', 'まだ何も決めていない。作業台で段取りを決めると、ここに記される。'));
    for (const act of m.acts) {
      const sec = el('section', 'history-act');
      sec.dataset.plan = act.planId;
      sec.append(el('h3', 'history-act-title', act.label));

      const chosen = el('section', 'result-block is-decided');
      chosen.append(el('h4', 'result-block-title', '選んだこと'));
      const dl = el('dl', 'forecast');
      act.choices.forEach((c) => dl.append(el('dt', undefined, c.item), el('dd', undefined, c.choice)));
      chosen.append(dl, el('p', 'result-note', `${act.agreedBy}が承知した。`));
      sec.append(chosen);

      if (act.result) {
        const cols = el('div', 'result-columns');
        const achieved = el('section', 'result-block is-achieved');
        achieved.append(el('h4', 'result-block-title', `その結果：${act.result.title}`), list(act.result.achieved));
        const remains = el('section', 'result-block is-costs');
        remains.append(el('h4', 'result-block-title', '残ったこと'), list(act.result.remains));
        cols.append(achieved, remains);
        sec.append(cols);
      } else {
        sec.append(el('p', 'history-pending', '結果は、作業の日を終えると記される。'));
      }

      if (act.knownAtDecision.length > 0) sec.append(details(`決めたときに分かっていたこと（${act.knownAtDecision.length}）`, act.knownAtDecision));
      if (act.revisions.length > 0) sec.append(details(`決めるまでに断られた・条件が付いた案（${act.revisions.length}）`, act.revisions));
      if (act.notChosen.length > 0) sec.append(details(`承諾を得ていたが、選ばなかった案（${act.notChosen.length}）`, act.notChosen));
      parts.push(sec);
    }
    if (m.promises.length > 0) {
      const p = el('section', 'result-block is-other');
      p.append(el('h3', 'result-block-title', '約束のゆくえ'));
      const ul = el('ul');
      m.promises.forEach((x) => {
        const li = el('li', undefined, `${x.from} → ${x.to}：${x.content}`);
        li.append(el('span', `history-promise${x.kept ? ' is-kept' : ''}`, x.kept ? '果たした' : 'まだ'));
        ul.append(li);
      });
      p.append(ul);
      parts.push(p);
    }
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

function details(summary: string, items: readonly string[]): HTMLElement {
  const d = el('details', 'history-details');
  d.append(el('summary', undefined, summary), list(items));
  return d;
}
