import type { OutcomeView } from '../journal/planModels';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 計画を決めた後の結果画面。点数ではなく、選択によって起きた具体的な変化を示す（設計書 M 節）。
 * 「自分が決めたこと」「実現したこと」「その代わりに残ったこと」を分け、選ばなかった案も一行ずつ示す。
 */
export class ResultView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, onClose: () => void, onHistory: () => void) {
    this.layer = overlayLayer('result-layer');
    const panel = el('div', 'result panel-paper');
    panel.setAttribute('role', 'dialog');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'paper-footer');
    footer.append(
      el('div', 'plan-foot-note', '村に戻ると、住民の様子や結帳でも違いを確かめられる。'),
      uiButton('plan-pick', '選んだことの記録', onHistory),
      uiButton('plan-decide', '先へ進む［Enter］', onClose),
    );
    panel.append(this.bodyEl, footer);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(v: OutcomeView): void {
    const head = el('div', 'result-head');
    head.append(el('div', 'result-when', v.when), el('h2', 'result-title', v.title));
    const story = el('div', 'result-story');
    v.story.forEach((t) => story.append(el('p', undefined, t)));

    const decided = block('自分が決めたこと', 'is-decided');
    decided.append(el('p', 'result-plan', v.decided.plan), el('p', 'result-note', `${v.decided.agreedBy}が承知した。`));

    const achieved = block('実現したこと', 'is-achieved');
    achieved.append(list(v.achieved));
    const costs = block('その代わりに残ったこと', 'is-costs');
    costs.append(list(v.costs));
    const columns = el('div', 'result-columns');
    columns.append(achieved, costs);

    const parts: HTMLElement[] = [head, story, decided, columns];
    if (v.notChosen.length > 0) {
      const other = block('承諾を得ていたが、選ばなかった案', 'is-other');
      const ul = el('ul');
      v.notChosen.forEach((n) => {
        const li = el('li');
        li.append(el('span', 'result-other-tagline', n.tagline), el('span', 'result-note', `（${n.plan}）`));
        ul.append(li);
      });
      other.append(ul);
      parts.push(other);
    }
    this.bodyEl.replaceChildren(...parts);
    this.bodyEl.scrollTop = 0;
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}

function block(title: string, cls: string): HTMLElement {
  const s = el('section', `result-block ${cls}`);
  s.append(el('h3', 'result-block-title', title));
  return s;
}

function list(items: readonly string[]): HTMLElement {
  const ul = el('ul');
  items.forEach((t) => ul.append(el('li', undefined, t)));
  return ul;
}
