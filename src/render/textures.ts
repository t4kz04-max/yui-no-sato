import * as THREE from 'three';
import { createRandom } from '../core/random';

/**
 * コードで描くテクスチャ（外部の画像素材は使わない）。
 * どれも明るさの揺らぎだけを持つ灰色に近い画像で、色はマテリアルの色・頂点色で付ける
 * （同じテクスチャを、古い茅・新しい茅・苔などに使い回すため）。
 * ブラウザ（DOM の canvas）が必要。
 */

type Draw = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

function canvasTexture(size: number, seed: number, draw: Draw, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas を作れません');
  draw(ctx, size, createRandom(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  return tex;
}

const grey = (v: number, a = 1) => {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${c},${c},${Math.round(c * 0.97)},${a})`;
};

/** 端をまたいで描く（タイル状に繰り返したとき継ぎ目が出ないように）。 */
function wrapped(size: number, x: number, y: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(x + dx, y + dy);
}

/** 茅の繊維：縦（屋根の流れ方向）の短い筋を重ねる。 */
export function thatchTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 11, (ctx, s, rand) => {
    ctx.fillStyle = grey(0.78);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const len = 10 + rand() * 34;
      const v = 0.55 + rand() * 0.5;
      ctx.strokeStyle = grey(v, 0.55 + rand() * 0.4);
      ctx.lineWidth = 0.8 + rand() * 1.4;
      const lean = (rand() - 0.5) * 3;
      wrapped(s, x, y, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + lean, py + len);
        ctx.stroke();
      });
    }
    // 層の段（葺き重ねた茅の段差）
    for (let y = 0; y < s; y += 32) {
      ctx.fillStyle = grey(0.45, 0.22);
      ctx.fillRect(0, y, s, 3);
    }
  });
}

/** 茅の切り口：軒先・妻側に見える茎の断面（細かな点）。 */
export function thatchCutTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 23, (ctx, s, rand) => {
    ctx.fillStyle = grey(0.6);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const x = rand() * s;
      const y = rand() * s;
      ctx.fillStyle = grey(0.55 + rand() * 0.5, 0.9);
      const r = 0.8 + rand() * 1.3;
      wrapped(s, x, y, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

/** 板：横に並んだ板と木目。 */
export function boardTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 31, (ctx, s, rand) => {
    const boards = 8;
    const h = s / boards;
    for (let b = 0; b < boards; b++) {
      ctx.fillStyle = grey(0.78 + rand() * 0.18);
      ctx.fillRect(0, b * h, s, h);
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = grey(0.6 + rand() * 0.2, 0.35);
        ctx.lineWidth = 0.6;
        const y = b * h + rand() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + (rand() - 0.5) * 3, s * 0.7, y + (rand() - 0.5) * 3, s, y);
        ctx.stroke();
      }
      ctx.fillStyle = grey(0.35, 0.8);
      ctx.fillRect(0, b * h, s, 1.2);
    }
  });
}

/** 障子：白い紙と細い桟の格子。 */
export function shojiTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 41, (ctx, s) => {
    ctx.fillStyle = '#f4efe0';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#7a6448';
    const cols = 3;
    const rows = 4;
    for (let c = 0; c <= cols; c++) ctx.fillRect((c * s) / cols - 1, 0, 2, s);
    for (let r = 0; r <= rows; r++) ctx.fillRect(0, (r * s) / rows - 1, s, 2);
  });
}

/** 地面の細かな揺らぎ（草地・土の質感）。 */
export function groundDetailTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    53,
    (ctx, s, rand) => {
      ctx.fillStyle = grey(0.9);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1800; i++) {
        const x = rand() * s;
        const y = rand() * s;
        ctx.fillStyle = grey(0.7 + rand() * 0.35, 0.5);
        const w = 1 + rand() * 2;
        const h = 1 + rand() * 2;
        wrapped(s, x, y, (px, py) => ctx.fillRect(px, py, w, h));
      }
    },
    [70, 70],
  );
}
