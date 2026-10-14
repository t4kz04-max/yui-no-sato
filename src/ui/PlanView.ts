import type { PlanBoardModel } from '../journal/planModels';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 宗平の作業台（計画）。案を項目ごとに選び、関係する人の返事と、手帳で知っていることを並べて比べる。
 * 返事は住民と直接話して聞く（ここでは承諾を集めない）。全員が今の案を承諾したときだけ決められる。
 */
export interface PlanViewHandlers {
  onSelect(item: string, option: string): void;
  onDecide(): void;
  onClose(): void;
  onNotebook(): void;
}

export class PlanView {
  private readonly layer: HTMLDivElement;
  private readonly bodyEl: HTMLElement;
  private readonly decideBtn: HTMLButtonElement;
  private readonly footNote: HTMLElement;

  constructor(parent: HTMLElement, private readonly handlers: PlanViewHandlers) {
    this.layer = overlayLayer('plan-layer');
    const panel = el('div', 'plan');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '屋根葺きの段取り');
    const header = el('div', 'plan-header');
    const actions = el('div', 'ledger-actions');
    actions.append(
      uiButton('panel-close is-ink', '手帳［Tab］', handlers.onNotebook),
      uiButton('panel-close is-ink', '閉じる［Esc］', handlers.onClose),
    );
    header.append(el('div', 'plan-title', '屋根葺きの段取り'), actions);
    this.bodyEl = el('div', 'plan-body');
    const footer = el('div', 'plan-footer');
    this.footNote = el('div', 'plan-foot-note');
    this.decideBtn = uiButton('plan-decide', 'この案で決める', handlers.onDecide);
    footer.append(this.footNote, this.decideBtn);
    panel.append(header, this.bodyEl, footer);
    this.layer.append(panel);
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer) handlers.onClose();
    });
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  hide(): void {
    this.layer.hidden = true;
  }

  show(m: PlanBoardModel): void {
    const scroll = this.visible ? this.bodyEl.scrollTop : 0;
    this.layer.hidden = false;
    const parts: HTMLElement[] = [];

    if (m.decided) {
      parts.push(el('div', 'plan-decided', `この段取りで決めた：${m.outcomeTitle ?? ''}`));
    }

    // 案
    const proposal = el('section', 'plan-section');
    proposal.append(el('div', 'plan-section-title', m.decided ? '決めた案' : '案'));
    for (const item of m.items) {
      const row = el('div', 'plan-item');
      row.dataset.item = item.id;
      row.append(el('div', 'plan-item-label', item.label));
      const opts = el('div', 'plan-options');
      for (const o of item.options) {
        const b = uiButton(`plan-option${o.selected ? ' is-selected' : ''}`, o.label, () => {
          if (!m.decided && !o.selected) this.handlers.onSelect(item.id, o.id);
        });
        b.dataset.option = o.id;
        b.disabled = m.decided && !o.selected;
        if (o.detail) b.append(el('span', 'plan-option-detail', o.detail));
        opts.append(b);
      }
      row.append(opts);
      if (item.hidden > 0 && !m.decided) {
        row.append(el('div', 'plan-hidden', 'ほかにも考えられる案があるかもしれない（村で話を聞き、調べてみる）'));
      }
      proposal.append(row);
    }
    if (m.invalidReason) proposal.append(el('div', 'plan-warning', m.invalidReason));
    parts.push(proposal);

    // 返事
    if (!m.decided) {
      const res = el('section', 'plan-section');
      res.append(el('div', 'plan-section-title', 'この案への返事（本人に話して聞く）'));
      if (m.responses.length === 0) res.append(el('div', 'plan-muted', '案が成り立たないため、まだ相談できない。'));
      for (const r of m.responses) {
        const line = el('div', `plan-response is-${r.state}`);
        line.dataset.npc = r.npc;
        line.append(el('span', 'plan-response-name', r.name), el('span', 'plan-response-chip', r.label));
        if (r.summary) line.append(el('span', 'plan-response-summary', r.summary));
        res.append(line);
      }
      parts.push(res);
    }

    // 判断の材料
    const facts = el('section', 'plan-section');
    facts.append(el('div', 'plan-section-title', '考えておくこと（手帳より）'));
    if (m.considerations.length === 0) facts.append(el('div', 'plan-muted', 'まだ判断の材料が少ない。'));
    m.considerations.forEach((c) => {
      const line = el('div', 'plan-fact');
      line.append(el('span', 'plan-fact-title', c.title), el('span', undefined, c.text));
      facts.append(line);
    });
    parts.push(facts);

    if (m.past.length > 0) {
      const past = el('details', 'plan-section plan-past');
      past.append(el('summary', undefined, `以前の案への返事（${m.past.length}）`));
      m.past.forEach((p) => past.append(el('div', 'plan-past-line', `${p.plan} … ${p.name}：${p.label}${p.summary ? `（${p.summary}）` : ''}`)));
      parts.push(past);
    }

    this.bodyEl.replaceChildren(...parts);
    this.bodyEl.scrollTop = scroll;

    this.decideBtn.hidden = m.decided;
    this.decideBtn.disabled = !m.canDecide;
    this.footNote.textContent = m.decided
      ? '決めた段取りは変えられない。'
      : m.canDecide
        ? '関係する全員が、この案を承知している。決めた後は変えられない。'
        : '案を変えたら、関係する人にもう一度話して返事を聞く。全員が承知した案だけ決められる。';
  }
}
