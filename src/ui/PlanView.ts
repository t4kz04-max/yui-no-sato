import type { ForecastLine } from '../content/plan';
import type { PlanBoardModel } from '../journal/planModels';
import type { PlanSpec } from '../story/types';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 宗平の作業台（計画）。
 * 左：案を組み立てる。
 * 右：その案で起きること（見込み）、関係する人の返事、承諾を得た案の見比べ、この案に関わる事情。
 * 返事は住民と直接話して聞く（ここでは承諾を集めない）。全員が今の案を承諾したときだけ決められる。
 */
export interface PlanViewHandlers {
  onSelect(item: string, option: string): void;
  /** 承諾を得た案を、作業台に広げ直す。 */
  onPick(plan: PlanSpec): void;
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
    const panel = el('div', 'plan panel-paper');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '屋根葺きの段取り');
    const header = el('div', 'paper-header');
    const actions = el('div', 'paper-actions');
    actions.append(
      uiButton('panel-close is-ink', '手帳［Tab］', handlers.onNotebook),
      uiButton('panel-close is-ink', '閉じる［Esc］', handlers.onClose),
    );
    header.append(el('div', 'paper-title', '屋根葺きの段取り'), actions);
    this.bodyEl = el('div', 'plan-body');
    const footer = el('div', 'paper-footer');
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

    const left = el('div', 'plan-col');
    const right = el('div', 'plan-col');

    if (m.decided) left.append(el('div', 'plan-decided', `この段取りで決めた：${m.outcomeTitle ?? ''}`));

    // ── 左：案 ──
    const proposal = section(m.decided ? '決めた案' : '案を組み立てる');
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
      if (item.hidden > 0 && !m.decided) row.append(el('div', 'plan-hidden', 'ほかにも考えられる案があるかもしれない（村で話を聞き、調べてみる）'));
      proposal.append(row);
    }
    if (m.invalidReason) proposal.append(el('div', 'plan-warning', m.invalidReason));
    left.append(proposal);

    // ── 右：見込み（判断の中心なので最初に見える位置に） ──
    if (m.forecast.length > 0) {
      const fc = section('この案で起きること（見込み）');
      fc.classList.add('plan-forecast');
      fc.append(forecastList(m.forecast));
      right.append(fc);
    }

    // ── 右：返事 ──
    if (!m.decided) {
      const res = section('この案への返事（本人に話して聞く）');
      if (m.responses.length === 0) res.append(el('div', 'plan-muted', '案が成り立たないため、まだ相談できない。'));
      for (const r of m.responses) {
        const line = el('div', `plan-response is-${r.state}`);
        line.dataset.npc = r.npc;
        const head = el('div', 'plan-response-head');
        head.append(el('span', 'plan-response-name', r.name), el('span', 'plan-response-chip', r.label));
        line.append(head);
        if (r.summary) line.append(el('div', 'plan-response-summary', r.summary));
        res.append(line);
      }
      right.append(res);
    }

    // ── 右：承諾を得た案（見比べて選ぶ） ──
    if (!m.decided && m.agreed.length > 0) {
      const ag = section(`承諾を得た案（${m.agreed.length}）`);
      ag.classList.add('plan-agreed');
      if (m.agreed.length > 1) ag.append(el('p', 'plan-muted', 'どれも関係する人が承知している。何を大切にするかで選ぶ。'));
      for (const a of m.agreed) {
        const card = el('details', `plan-agreed-card${a.current ? ' is-current' : ''}`);
        card.dataset.key = a.key;
        card.open = a.current || m.agreed.length <= 2;
        const summary = el('summary', 'plan-agreed-label', a.label);
        if (a.current) summary.append(el('span', 'plan-current-chip', '広げている案'));
        card.append(summary, forecastList(a.forecast));
        if (!a.current) card.append(uiButton('plan-pick', 'この案を広げる', () => this.handlers.onPick(a.plan)));
        ag.append(card);
      }
      right.append(ag);
    }

    // ── 右：この案に関わる事情 ──
    const facts = section('この案に関わる事情（手帳より）');
    if (m.considerations.length === 0) facts.append(el('div', 'plan-muted', 'この案に関わることは、まだ手帳に書かれていない。'));
    for (const c of m.considerations) {
      const d = el('details', 'plan-fact');
      const s = el('summary');
      s.append(el('span', 'plan-fact-title', c.title), el('span', 'plan-fact-summary', c.summary));
      d.append(s, el('div', 'plan-fact-text', c.text));
      facts.append(d);
    }
    right.append(facts);

    if (m.past.length > 0) {
      const past = el('details', 'plan-section plan-past');
      past.append(el('summary', undefined, `以前の案への返事（${m.past.length}）`));
      m.past.forEach((p) => past.append(el('div', 'plan-past-line', `${p.plan} … ${p.name}：${p.label}${p.summary ? `（${p.summary}）` : ''}`)));
      right.append(past);
    }

    this.bodyEl.replaceChildren(left, right);
    this.bodyEl.scrollTop = scroll;

    this.decideBtn.hidden = m.decided;
    this.decideBtn.disabled = !m.canDecide;
    this.footNote.textContent = m.decided
      ? '決めた段取りは変えられない。'
      : m.canDecide
        ? '関係する全員が、広げている案を承知している。決めた後は変えられない。'
        : '案を変えたら、関係する人にもう一度話して返事を聞く。全員が承知した案だけ決められる。';
  }
}

function section(title: string): HTMLElement {
  const s = el('section', 'plan-section');
  s.append(el('h3', 'plan-section-title', title));
  return s;
}

function forecastList(lines: readonly ForecastLine[]): HTMLElement {
  const dl = el('dl', 'forecast');
  for (const f of lines) {
    dl.append(el('dt', undefined, f.aspect), el('dd', f.uncertain ? 'is-uncertain' : undefined, f.text));
  }
  return dl;
}
