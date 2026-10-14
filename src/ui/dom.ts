/** UI で共通に使う小さな DOM ヘルパー。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * フォーカスを持たないボタン。キーボード操作はゲーム側でまとめて扱うため、
 * ブラウザ既定の Space／Enter によるクリックと二重に反応しないようにする。
 */
export function uiButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** 全画面の受け皿（背後の 3D 画面にクリック・ホイールを通さない）。 */
export function overlayLayer(className: string): HTMLDivElement {
  const layer = el('div', `overlay-layer ${className}`);
  layer.hidden = true;
  layer.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  return layer;
}
