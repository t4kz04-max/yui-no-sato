/**
 * 操作できる対象の頭上に出す「E 話す」の案内（設計書 M 節：近づいたときだけ表示）。
 * 画面上の位置は呼び出し側が 3D 座標から計算して渡す。
 */
export interface PromptContent {
  readonly key: string;
  readonly action: string;
  readonly label: string;
  /** 一度調べたもの・話した相手に付ける印。 */
  readonly done: boolean;
}

export class InteractionPrompt {
  private readonly el: HTMLElement;
  private currentKey = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'interaction-prompt';
    this.el.hidden = true;
    parent.append(this.el);
  }

  show(content: PromptContent, screenX: number, screenY: number): void {
    const key = `${content.key}|${content.done}`;
    if (key !== this.currentKey) {
      this.currentKey = key;
      this.el.replaceChildren();
      const kbd = document.createElement('kbd');
      kbd.textContent = 'E';
      const action = document.createElement('span');
      action.className = 'interaction-prompt-action';
      action.textContent = content.action;
      const label = document.createElement('span');
      label.className = 'interaction-prompt-label';
      label.textContent = content.label;
      this.el.append(kbd, action, label);
      if (content.done) {
        const done = document.createElement('span');
        done.className = 'interaction-prompt-done';
        done.textContent = '済';
        done.title = '一度話した・調べた';
        this.el.append(done);
      }
    }
    this.el.style.transform = `translate(${Math.round(screenX)}px, ${Math.round(screenY)}px) translate(-50%, -100%)`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }
}
