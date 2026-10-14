/**
 * 探索中の最小限の HUD（操作説明とデバッグ表示）。
 * DOM 操作はこのクラスに閉じ込め、ゲームロジックからは表示内容だけを渡す。
 */
export interface DebugInfo {
  readonly fps: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly area: string;
  readonly drawCalls: number;
}

export class Hud {
  private readonly debugEl: HTMLElement;
  private readonly helpEl: HTMLElement;
  private debugVisible = false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '';
    const title = el('div', 'hud-title');
    title.innerHTML = '<span class="hud-title-main">結の約束</span><span class="hud-title-sub">（仮）開発版 Phase 0</span>';

    this.helpEl = el('div', 'hud-help');
    this.helpEl.innerHTML = [
      ['W A S D', '移動'],
      ['Shift', '走る'],
      ['ドラッグ', '視点'],
      ['ホイール', 'ズーム'],
      ['H', '操作説明'],
      ['F3', 'デバッグ'],
    ]
      .map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`)
      .join('');

    this.debugEl = el('div', 'hud-debug');
    this.debugEl.hidden = true;

    root.append(title, this.helpEl, this.debugEl);
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugEl.hidden = !this.debugVisible;
  }

  toggleHelp(): void {
    this.helpEl.hidden = !this.helpEl.hidden;
  }

  get isDebugVisible(): boolean {
    return this.debugVisible;
  }

  updateDebug(info: DebugInfo): void {
    if (!this.debugVisible) return;
    this.debugEl.textContent =
      `FPS ${info.fps}  draw ${info.drawCalls}\n` +
      `x ${info.x.toFixed(1)}  y ${info.y.toFixed(2)}  z ${info.z.toFixed(1)}\n` +
      `近くの地点: ${info.area}`;
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
