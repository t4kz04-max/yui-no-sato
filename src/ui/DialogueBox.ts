import { parseEmphasis, type TextSegment } from '../dialogue/markup';
/**
 * 画面下部の会話ウィンドウ（設計書 M 節）。表示と DOM 操作だけを担当し、
 * 会話の進行は呼び出し側（InteractionSystem）に任せる。
 *
 * 文字送り（1文字ずつ表示）は見た目だけの状態なのでここで管理する。
 */
export interface DialogueBoxModel {
  /** ページが変わったことを判定するための識別子。 */
  readonly key: string;
  /** null は地の文（調査の描写・心の声）。 */
  readonly speakerName: string | null;
  /** 地の文のときに見出しとして出す、調べている物の名前。 */
  readonly subject?: string;
  readonly text: string;
  readonly choices: readonly string[];
  readonly selected: number;
}

export interface DialogueBoxHandlers {
  /** 画面のクリック（選択肢以外）。 */
  onAdvance(): void;
  onChoose(index: number): void;
  onHover(index: number): void;
}

/** 文字送りの速さの既定（1 秒あたりの文字数）。設定画面で変えられる（Phase 6）。 */
const CHARS_PER_SECOND = 45;
/**
 * 選択肢が出てからキーで選べるまでの猶予（秒）。文字送りを飛ばすつもりで押した決定キーが、
 * 表示された直後の選択肢を誤って選んでしまうのを防ぐ。
 */
const CHOICE_KEY_DELAY = 0.3;

export class DialogueBox {
  private readonly layer: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly nextEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private model: DialogueBoxModel | null = null;
  private shown = 0;
  private segments: TextSegment[] = [];
  private plainLength = 0;
  private renderedChoicesKey = '';
  private choicesVisibleTime = 0;
  /** 文字送りの速さ（Infinity で一度に全文）。 */
  charsPerSecond = CHARS_PER_SECOND;

  constructor(parent: HTMLElement, private readonly handlers: DialogueBoxHandlers) {
    this.layer = el('div', 'dialogue-layer');
    this.layer.hidden = true;
    const box = el('div', 'dialogue-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    this.nameEl = el('div', 'dialogue-name');
    this.textEl = el('div', 'dialogue-text');
    this.nextEl = el('div', 'dialogue-next');
    this.nextEl.textContent = '▼';
    this.choicesEl = el('div', 'dialogue-choices');
    box.append(this.nameEl, this.textEl, this.nextEl);
    this.layer.append(this.choicesEl, box);
    parent.append(this.layer);

    // 会話中は画面全体でクリックを受け止め、カメラのドラッグなどが起きないようにする
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if ((e.target as HTMLElement).closest('.dialogue-choice')) return;
      this.handlers.onAdvance();
    });
    this.layer.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  /** 文字送りの途中か。 */
  get isRevealing(): boolean {
    return this.model !== null && this.shown < this.plainLength;
  }

  /** 選択肢をキーで選んでよいか（表示されてから少し経ったか）。 */
  get choicesReady(): boolean {
    return !this.choicesEl.hidden && this.choicesVisibleTime >= CHOICE_KEY_DELAY;
  }

  show(model: DialogueBoxModel): void {
    const pageChanged = this.model?.key !== model.key;
    this.model = model;
    this.layer.hidden = false;
    if (pageChanged) {
      this.shown = 0;
      this.segments = parseEmphasis(model.text);
      this.plainLength = this.segments.reduce((n, seg) => n + seg.text.length, 0);
      const title = model.speakerName ?? model.subject ?? null;
      this.nameEl.textContent = title ?? '';
      this.nameEl.hidden = title === null;
      this.nameEl.classList.toggle('is-subject', model.speakerName === null);
      this.textEl.classList.toggle('is-narration', model.speakerName === null);
      this.renderedChoicesKey = '';
      this.renderText();
    }
    this.renderChoices();
  }

  hide(): void {
    this.model = null;
    this.layer.hidden = true;
    this.choicesEl.replaceChildren();
    this.renderedChoicesKey = '';
  }

  revealAll(): void {
    if (!this.model) return;
    this.shown = this.plainLength;
    this.renderText();
    this.renderChoices();
  }

  update(dt: number): void {
    if (!this.choicesEl.hidden) this.choicesVisibleTime += dt;
    if (!this.model || !this.isRevealing) return;
    this.shown = Number.isFinite(this.charsPerSecond) ? Math.min(this.plainLength, this.shown + dt * this.charsPerSecond) : this.plainLength;
    this.renderText();
    if (!this.isRevealing) this.renderChoices();
  }

  private renderText(): void {
    if (!this.model) return;
    // 強調（**…**）を保ったまま、表示した文字数の分だけ描く
    let remaining = Math.floor(this.shown);
    const nodes: Node[] = [];
    for (const seg of this.segments) {
      if (remaining <= 0) break;
      const text = seg.text.slice(0, remaining);
      remaining -= text.length;
      nodes.push(seg.strong ? el('strong', 'dialogue-em', text) : document.createTextNode(text));
    }
    this.textEl.replaceChildren(...nodes);
    this.nextEl.hidden = this.isRevealing || this.model.choices.length > 0;
  }

  /** 選択肢は本文を表示し終えてから出す。 */
  private renderChoices(): void {
    const m = this.model;
    const choices = m && !this.isRevealing ? m.choices : [];
    const key = `${m?.key ?? ''}|${choices.join('\n')}`;
    if (key !== this.renderedChoicesKey) {
      this.renderedChoicesKey = key;
      this.choicesVisibleTime = 0;
      this.choicesEl.replaceChildren(
        ...choices.map((text, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'dialogue-choice';
          // キーボード操作はゲーム側で扱うので、フォーカスを持たせない（Space/Enter の二重反応を防ぐ）
          b.tabIndex = -1;
          b.innerHTML = `<span class="dialogue-choice-num">${i + 1}</span>`;
          b.append(document.createTextNode(text));
          b.addEventListener('pointerdown', (e) => e.preventDefault());
          b.addEventListener('click', () => this.handlers.onChoose(i));
          b.addEventListener('pointerenter', () => this.handlers.onHover(i));
          return b;
        }),
      );
    }
    this.choicesEl.hidden = choices.length === 0;
    if (m) {
      this.choicesEl.querySelectorAll('.dialogue-choice').forEach((b, i) => b.classList.toggle('is-selected', i === m.selected));
    }
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
