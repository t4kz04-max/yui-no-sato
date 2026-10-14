import { Game } from './game/Game';
import { WebGLUnavailableError } from './render/createRenderer';
import { Hud } from './ui/Hud';

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el;
}

const canvasRoot = requireElement('canvas-root');
const hudRoot = requireElement('hud');
const loading = document.getElementById('loading');

/** ローディング表示を消す（少しだけ溶かす）。 */
function hideLoading(): void {
  if (!loading) return;
  loading.classList.add('is-done');
  setTimeout(() => loading.remove(), 600);
}

function boot(): void {
  try {
    const game = new Game(canvasRoot, hudRoot);
    game.start();
    if (import.meta.env.DEV) {
      // 開発時の動作確認用（ブラウザのコンソールから状態を参照できる）
      (window as unknown as { __yui: Game }).__yui = game;
    }
  } catch (e) {
    console.error(e);
    const message =
      e instanceof WebGLUnavailableError
        ? 'WebGL を初期化できませんでした。ハードウェアアクセラレーションが有効な最新のブラウザでお試しください。'
        : `起動中にエラーが発生しました：${e instanceof Error ? e.message : String(e)}`;
    new Hud(hudRoot).showFatal(message);
  }
  hideLoading();
}

// 村の組み立て（数百ミリ秒かかる）の前に、ローディング表示を一度描かせる
requestAnimationFrame(() => setTimeout(boot, 0));
