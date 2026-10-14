import { el, uiButton } from './dom';

/**
 * 時間の経過を伝える画面（暗転 → 見出し → 一行ずつ → 村へ）。屋根葺きの日の朝、三年後の秋に使う。
 * 長い強制の場面にしないよう、決定キー・クリックで一行ずつ早送りでき、最後は「村に出る」で閉じる。
 */
export interface TransitionContent {
  /** 小さな見出し（例：「それから」）。 */
  readonly kicker?: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly button: string;
}

const LINE_INTERVAL = 1.1;
const FIRST_DELAY = 0.6;

export class TransitionView {
  private readonly layer: HTMLDivElement;
  private readonly kickerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly linesEl: HTMLElement;
  private readonly button: HTMLButtonElement;
  private content: TransitionContent | null = null;
  private shown = 0;
  private timer = 0;

  constructor(parent: HTMLElement, private readonly onDone: () => void) {
    this.layer = el('div', 'overlay-layer transition-layer');
    this.layer.hidden = true;
    const box = el('div', 'transition-box');
    box.setAttribute('role', 'dialog');
    this.kickerEl = el('div', 'transition-kicker');
    this.titleEl = el('div', 'transition-title');
    this.linesEl = el('div', 'transition-lines');
    this.button = uiButton('plan-decide transition-button', '', () => this.advance());
    box.append(this.kickerEl, this.titleEl, this.linesEl, this.button);
    this.layer.append(box);
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest('button')) this.advance();
    });
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  /** すべての行を出し終えたか。 */
  get complete(): boolean {
    return this.content !== null && this.shown >= this.content.lines.length;
  }

  show(c: TransitionContent): void {
    this.content = c;
    this.shown = 0;
    this.timer = FIRST_DELAY;
    this.kickerEl.textContent = c.kicker ?? '';
    this.kickerEl.hidden = !c.kicker;
    this.titleEl.textContent = c.title;
    this.linesEl.replaceChildren(...c.lines.map((t) => el('p', 'transition-line', t)));
    this.button.textContent = `${c.button}［Enter］`;
    this.layer.hidden = false;
    this.layer.classList.remove('is-in');
    void this.layer.offsetWidth;
    this.layer.classList.add('is-in');
    this.render();
  }

  hide(): void {
    this.layer.hidden = true;
    this.content = null;
  }

  update(dt: number): void {
    if (!this.content || this.complete) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.shown++;
      this.timer = LINE_INTERVAL;
      this.render();
    }
  }

  /** 決定：まだ出ていない行があれば全部出す。出し終えていれば閉じる。 */
  advance(): void {
    if (!this.content) return;
    if (!this.complete) {
      this.shown = this.content.lines.length;
      this.render();
      return;
    }
    this.onDone();
  }

  private render(): void {
    this.linesEl.querySelectorAll('.transition-line').forEach((p, i) => p.classList.toggle('is-shown', i < this.shown));
    this.button.classList.toggle('is-ready', this.complete);
  }
}
