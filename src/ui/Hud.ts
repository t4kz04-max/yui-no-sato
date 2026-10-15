/**
 * 探索中の小さな HUD（タイトル・操作説明・目的・地点名・デバッグ表示）。
 * DOM 操作はこのクラスに閉じ込め、ゲームロジックからは表示内容だけを渡す。
 */
export interface DebugInfo {
  readonly fps: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly area: string;
  readonly drawCalls: number;
  readonly target: string;
  readonly mode: string;
  readonly flags: readonly string[];
  readonly learned: readonly string[];
}

export class Hud {
  private readonly debugEl: HTMLElement;
  private readonly helpEl: HTMLElement;
  private readonly objectiveEl: HTMLElement;
  private readonly objectiveTextEl: HTMLElement;
  private readonly areaEl: HTMLElement;
  private readonly notebookBadgeEl: HTMLElement;
  /** 初めて遊ぶ人向けの操作の手引き（画面下の中央）。 */
  private readonly hintEl: HTMLElement;
  private hintKey = '';
  /** 右上の縦の並び（目的・手帳の新着・通知）。重ならないように一つの列に積む。 */
  readonly rightColumn: HTMLElement;
  private debugVisible = false;
  private areaTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '';
    const title = el('div', 'hud-title');
    title.innerHTML = '<span class="hud-title-main">結の約束</span>';

    this.helpEl = el('div', 'hud-help');
    this.helpEl.innerHTML = [
      ['W A S D', '移動'],
      ['Shift', '走る'],
      ['E', '話す・調べる'],
      ['Tab', '手帳'],
      ['Esc', 'ポーズ・設定／会話をやめる'],
      ['ドラッグ', '見回す'],
      ['ホイール', '寄る・離れる'],
      ['M', '音を消す'],
      ['H', 'この一覧を隠す'],
      ['F3', 'デバッグ'],
    ]
      .map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`)
      .join('');

    this.objectiveEl = el('div', 'hud-objective');
    const objectiveLabel = el('div', 'hud-objective-label');
    objectiveLabel.textContent = 'いまできること';
    this.objectiveTextEl = el('div', 'hud-objective-text');
    this.objectiveEl.append(objectiveLabel, this.objectiveTextEl);
    this.objectiveEl.hidden = true;

    this.notebookBadgeEl = el('div', 'hud-notebook-badge');
    this.notebookBadgeEl.textContent = '手帳に新しい記録［Tab］';
    this.notebookBadgeEl.hidden = true;

    this.areaEl = el('div', 'hud-area');
    this.areaEl.hidden = true;

    this.debugEl = el('div', 'hud-debug');
    this.debugEl.hidden = true;

    this.rightColumn = el('div', 'hud-right');
    this.rightColumn.append(this.objectiveEl, this.notebookBadgeEl);
    this.hintEl = el('div', 'hud-hint');
    this.hintEl.hidden = true;
    root.append(title, this.rightColumn, this.areaEl, this.helpEl, this.hintEl, this.debugEl);
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugEl.hidden = !this.debugVisible;
  }

  /** 操作の手引きを出す（null で隠す）。 */
  setHint(hint: { readonly id: string; readonly keys: readonly string[]; readonly text: string } | null): void {
    const key = hint?.id ?? '';
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.hintEl.hidden = !hint;
    if (!hint) return;
    this.hintEl.replaceChildren(...hint.keys.map((k) => Object.assign(document.createElement('kbd'), { textContent: k })), Object.assign(document.createElement('span'), { textContent: hint.text }));
    this.hintEl.classList.remove('is-in');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('is-in');
  }

  get hint(): string {
    return this.hintKey;
  }

  /** 左下の操作一覧の表示（設定・H キー）。 */
  setHelpVisible(visible: boolean): void {
    this.helpEl.hidden = !visible;
  }

  get helpVisible(): boolean {
    return !this.helpEl.hidden;
  }

  toggleHelp(): void {
    this.helpEl.hidden = !this.helpEl.hidden;
  }

  get isDebugVisible(): boolean {
    return this.debugVisible;
  }

  /** 会話中は探索用の表示を控えめにする。 */
  setDialogueMode(active: boolean): void {
    this.root.classList.toggle('is-dialogue', active);
  }

  /** タイトル・時間経過・短い演出の間は、探索用の表示をすべて隠す（Phase 6）。 */
  setTitleMode(active: boolean): void {
    this.root.classList.toggle('is-title', active);
  }

  /** 手帳・結帳・ポーズなどの画面を開いている間は、探索用の表示を隠す。 */
  setOverlayMode(active: boolean): void {
    this.root.classList.toggle('is-overlay', active);
  }

  setNotebookBadge(visible: boolean): void {
    this.notebookBadgeEl.hidden = !visible;
  }

  setObjective(text: string): void {
    if (this.objectiveTextEl.textContent === text) return;
    this.objectiveTextEl.textContent = text;
    this.objectiveEl.hidden = text === '';
    // 目的が変わったことに気づけるよう軽く強調する
    this.objectiveEl.classList.remove('is-updated');
    void this.objectiveEl.offsetWidth;
    this.objectiveEl.classList.add('is-updated');
  }

  /** 地点に入ったときに地名を短く表示する。 */
  showArea(label: string): void {
    this.areaEl.textContent = label;
    this.areaEl.hidden = false;
    this.areaEl.classList.remove('is-visible');
    void this.areaEl.offsetWidth;
    this.areaEl.classList.add('is-visible');
    clearTimeout(this.areaTimer);
    this.areaTimer = setTimeout(() => this.areaEl.classList.remove('is-visible'), 2400);
  }

  updateDebug(info: DebugInfo): void {
    if (!this.debugVisible) return;
    this.debugEl.textContent =
      `FPS ${info.fps}  draw ${info.drawCalls}\n` +
      `x ${info.x.toFixed(1)}  y ${info.y.toFixed(2)}  z ${info.z.toFixed(1)}\n` +
      `近くの地点: ${info.area}\n` +
      `対象: ${info.target}\n` +
      `フラグ(${info.flags.length}): ${info.flags.slice(-4).join(', ') || '-'}`;
  }

  showFatal(message: string): void {
    const box = el('div', 'hud-fatal');
    box.textContent = message;
    this.root.append(box);
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
