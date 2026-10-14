import type { OutcomeView } from '../journal/planModels';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 計画を決めた後の結果画面。点数ではなく、選択によって起きた具体的な変化を示す（設計書 M 節）。
 */
export class ResultView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.layer = overlayLayer('result-layer');
    const panel = el('div', 'result');
    panel.setAttribute('role', 'dialog');
    this.bodyEl = el('div', 'result-body');
    const footer = el('div', 'result-footer');
    footer.append(uiButton('plan-decide', '村に戻る［Enter］', onClose));
    panel.append(this.bodyEl, footer);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(v: OutcomeView): void {
    const head = el('div', 'result-head');
    head.append(el('div', 'result-when', v.when), el('div', 'result-title', v.title), el('div', 'result-plan', `決めた段取り：${v.plan}`));
    const story = el('div', 'result-story');
    v.story.forEach((t) => story.append(el('p', undefined, t)));
    const changes = el('dl', 'result-changes');
    v.changes.forEach((c) => changes.append(el('dt', undefined, c.label), el('dd', undefined, c.text)));
    this.bodyEl.replaceChildren(head, story, el('div', 'result-section', '何が変わったか'), changes);
    this.layer.hidden = false;
  }

  hide(): void {
    this.layer.hidden = true;
  }
}
