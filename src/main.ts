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
