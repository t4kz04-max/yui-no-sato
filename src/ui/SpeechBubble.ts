import { el } from './dom';

/**
 * 頭上の短いひと言（屋根葺きの日の住民・村の人）。会話ウィンドウは開かず、歩きながら聞こえる程度に出す。
 * 位置（画面座標）は Game が毎フレーム渡す。
 */
export class SpeechBubble {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly textEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'speech-bubble');
    this.root.hidden = true;
    this.nameEl = el('span', 'speech-name');
    this.textEl = el('span', 'speech-text');
    this.root.append(this.nameEl, this.textEl);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(name: string | null, text: string): void {
    this.nameEl.textContent = name ?? '';
    this.nameEl.hidden = !name;
    this.textEl.textContent = text;
    this.root.hidden = false;
    this.root.classList.remove('is-in');
    void this.root.offsetWidth;
    this.root.classList.add('is-in');
  }

  place(x: number, y: number): void {
    this.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
