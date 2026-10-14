import {
  LOOK_SENSITIVITY_RANGE,
  TEXT_SPEED_LABEL,
  TEXT_SPEEDS,
  type Settings,
  type TextSpeed,
} from '../settings/settings';
import { el, overlayLayer, uiButton } from './dom';

/**
 * 設定画面。マウスでも、キー（↑↓：項目、←→：調整、Enter：切り替え、Esc：閉じる）でも操作できる。
 * 値の検証と保存は settings.ts（SettingsStore）が行い、ここは表示と入力だけを担当する。
 */
type Row =
  | { readonly id: keyof Settings; readonly kind: 'slider'; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly format: (v: number) => string }
  | { readonly id: keyof Settings; readonly kind: 'toggle'; readonly label: string; readonly note?: string }
  | { readonly id: 'textSpeed'; readonly kind: 'choice'; readonly label: string }
  | { readonly id: 'close'; readonly kind: 'button'; readonly label: string };

const percent = (v: number) => `${Math.round(v * 100)}`;
const ROWS: readonly Row[] = [
  {
    id: 'lookSensitivity',
    kind: 'slider',
    label: '視点の感度',
    min: LOOK_SENSITIVITY_RANGE.min,
    max: LOOK_SENSITIVITY_RANGE.max,
    step: 0.1,
    format: (v) => `${v.toFixed(1)} 倍`,
  },
  { id: 'invertY', kind: 'toggle', label: '視点の上下を反転' },
  { id: 'masterVolume', kind: 'slider', label: '全体の音量', min: 0, max: 1, step: 0.05, format: percent },
  { id: 'musicVolume', kind: 'slider', label: '音楽', min: 0, max: 1, step: 0.05, format: percent },
  { id: 'ambientVolume', kind: 'slider', label: '環境音（風・水・鳥）', min: 0, max: 1, step: 0.05, format: percent },
  { id: 'sfxVolume', kind: 'slider', label: '効果音（足音・操作音）', min: 0, max: 1, step: 0.05, format: percent },
  { id: 'muted', kind: 'toggle', label: '音を消す', note: 'M キーでも切り替えられる' },
  { id: 'textSpeed', kind: 'choice', label: '会話の文字の速さ' },
  { id: 'showHints', kind: 'toggle', label: '操作の手引きを出す', note: 'まだ行っていない操作を一つずつ案内する' },
  { id: 'showControls', kind: 'toggle', label: '左下に操作一覧を出す', note: 'H キーでも切り替えられる' },
  { id: 'close', kind: 'button', label: '閉じる［Esc］' },
];

export class SettingsView {
  private readonly layer: HTMLDivElement;
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private settings: Settings | null = null;
  private selected = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: { onChange(patch: Partial<Settings>): void; onClose(): void; onMove(): void },
  ) {
    this.layer = overlayLayer('settings-layer');
    const panel = el('div', 'settings-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '設定');
    this.listEl = el('div', 'settings-list');
    this.statusEl = el('div', 'settings-status');
    panel.append(el('div', 'menu-title', '設定'), this.listEl, this.statusEl);
    this.layer.append(panel);
    parent.append(this.layer);
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(settings: Settings, status = ''): void {
    this.settings = settings;
    this.selected = 0;
    this.layer.hidden = false;
    this.setStatus(status || '設定はこの端末に保存され、次に遊ぶときも使われる。');
    this.render();
  }

  /** 値が変わったとき（キー操作・保存の後）に表示を合わせる。 */
  update(settings: Settings): void {
    this.settings = settings;
    if (this.visible) this.refreshValues();
  }

  /** 要素を作り直さずに値だけ書き換える（スライダーをドラッグしている途中でも途切れないように）。 */
  private refreshValues(): void {
    const s = this.settings;
    if (!s) return;
    ROWS.forEach((row, i) => {
      const line = this.listEl.children[i] as HTMLElement | undefined;
      if (!line) return;
      if (row.kind === 'slider') {
        const v = s[row.id] as number;
        const input = line.querySelector<HTMLInputElement>('.settings-range');
        if (input && Number(input.value) !== v) input.value = String(v);
        const out = line.querySelector('.settings-value');
        if (out) out.textContent = row.format(v);
      } else if (row.kind === 'toggle') {
        const on = s[row.id] as boolean;
        const b = line.querySelector('.settings-toggle');
        if (b) {
          b.textContent = on ? 'する' : 'しない';
          b.classList.toggle('is-on', on);
        }
      } else if (row.kind === 'choice') {
        line.querySelectorAll('.settings-choice').forEach((b, j) => b.classList.toggle('is-on', TEXT_SPEEDS[j] === s.textSpeed));
      }
    });
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  hide(): void {
    this.layer.hidden = true;
  }

  moveSelection(delta: number): void {
    this.selected = (this.selected + delta + ROWS.length) % ROWS.length;
    this.handlers.onMove();
    this.renderSelection();
  }

  /** ←→：スライダーは一段、切り替えは反転、選択は前後へ。 */
  adjust(delta: number): void {
    const row = ROWS[this.selected]!;
    const s = this.settings;
    if (!s) return;
    if (row.kind === 'slider') {
      const v = s[row.id] as number;
      const next = Math.min(row.max, Math.max(row.min, Math.round((v + delta * row.step) / row.step) * row.step));
      this.handlers.onChange({ [row.id]: Number(next.toFixed(2)) } as Partial<Settings>);
    } else if (row.kind === 'toggle') {
      this.handlers.onChange({ [row.id]: !s[row.id] } as Partial<Settings>);
    } else if (row.kind === 'choice') {
      const i = TEXT_SPEEDS.indexOf(s.textSpeed);
      this.handlers.onChange({ textSpeed: TEXT_SPEEDS[(i + delta + TEXT_SPEEDS.length) % TEXT_SPEEDS.length]! });
    }
  }

  /** Enter：切り替え・閉じる。 */
  activate(): void {
    const row = ROWS[this.selected]!;
    if (row.kind === 'button') this.handlers.onClose();
    else if (row.kind !== 'slider') this.adjust(1);
  }

  private render(): void {
    const s = this.settings;
    if (!s) return;
    this.listEl.replaceChildren(
      ...ROWS.map((row, i) => {
        const line = el('div', `settings-row is-${row.kind}`);
        line.dataset.id = row.id;
        line.addEventListener('pointerenter', () => {
          if (this.selected !== i) {
            this.selected = i;
            this.renderSelection();
          }
        });
        if (row.kind === 'button') {
          line.append(uiButton('menu-item settings-close', row.label, () => this.handlers.onClose()));
          return line;
        }
        const label = el('div', 'settings-label', row.label);
        if (row.kind === 'toggle' && row.note) label.append(el('span', 'settings-note', row.note));
        line.append(label);
        if (row.kind === 'slider') {
          const value = s[row.id] as number;
          const input = el('input', 'settings-range');
          input.type = 'range';
          input.min = String(row.min);
          input.max = String(row.max);
          input.step = String(row.step);
          input.value = String(value);
          // キー操作はゲーム側でまとめて扱う（フォーカスを残さない）
          input.tabIndex = -1;
          input.addEventListener('input', () => this.handlers.onChange({ [row.id]: Number(input.value) } as Partial<Settings>));
          input.addEventListener('pointerup', () => input.blur());
          input.addEventListener('change', () => input.blur());
          line.append(input, el('span', 'settings-value', row.format(value)));
        } else if (row.kind === 'toggle') {
          const on = s[row.id] as boolean;
          // 押した時点の値を読む（表示は refreshValues で書き換わるため、作ったときの値を使わない）
          const b = uiButton(`settings-toggle${on ? ' is-on' : ''}`, on ? 'する' : 'しない', () =>
            this.handlers.onChange({ [row.id]: !this.settings?.[row.id] } as Partial<Settings>),
          );
          line.append(b);
        } else {
          const group = el('div', 'settings-choices');
          for (const sp of TEXT_SPEEDS) {
            group.append(
              uiButton(`settings-choice${s.textSpeed === sp ? ' is-on' : ''}`, TEXT_SPEED_LABEL[sp as TextSpeed], () =>
                this.handlers.onChange({ textSpeed: sp }),
              ),
            );
          }
          line.append(group);
        }
        return line;
      }),
    );
    this.renderSelection();
  }

  private renderSelection(): void {
    this.listEl.querySelectorAll('.settings-row').forEach((r, i) => r.classList.toggle('is-selected', i === this.selected));
  }
}
