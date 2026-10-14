/**
 * ブラウザでの動作確認（Phase 0）。Vite 開発サーバーを起動し、ヘッドレス Chrome で
 * 起動・移動・衝突・カメラ・ズーム・リサイズ・コンソールエラーを確認する。
 *
 *   npm run test:browser
 *
 * Chrome の場所が異なる場合は環境変数 CHROME_PATH で指定する。
 * スクリーンショットは test-results/ に保存される。
 * ※ ソフトウェア描画（SwiftShader）で動かすため FPS の値は実機の性能を表さない。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test-results");
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const server = await createServer({ root: ROOT, server: { port: 5199, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5199/";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
const state = () =>
  page.evaluate(() => {
    const g = window.__yui;
    if (!g) return null;
    const c = g.camera.position;
    return {
      x: g.player.x, y: g.player.y, z: g.player.z, heading: g.player.heading,
      yaw: g.cameraYaw, dist: g.cameraRig?.orbit?.distance,
      cam: { x: c.x, y: c.y, z: c.z }, aspect: g.camera.aspect,
    };
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); await wait(300); };

await page.goto(url, { waitUntil: 'networkidle0' });
await wait(2500);

const s0 = await state();
check('ゲームが起動し状態を取得できる', !!s0, JSON.stringify(s0));
const gl = await page.evaluate(() => {
  const c = document.querySelector('#canvas-root canvas');
  return c ? { w: c.width, h: c.height, ctx: !!(c.getContext('webgl2') || c.getContext('webgl')) } : null;
});
check('WebGL キャンバスが存在する', !!gl && gl.ctx, JSON.stringify(gl));
check('スタート地点（橋の南）', Math.abs(s0.x) < 0.01 && Math.abs(s0.z - 31) < 0.01);
await page.screenshot({ path: `${OUT}/shot-01-start.png` });

// クリックしてフォーカス
await page.mouse.click(640, 360);

// 前進（北へ）→ 橋を渡る。ソフトウェア描画では FPS が低く実時間とゲーム時間がずれるため、
// 「条件を満たすまで押し続ける（タイムアウト付き）」で判定する。
const holdUntil = async (keys, cond, timeoutMs, onSample) => {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now();
  let s = await state();
  while (!cond(s) && Date.now() - t0 < timeoutMs) { await wait(40); s = await state(); onSample?.(s); }
  for (const k of keys) await page.keyboard.up(k);
  await wait(300);
  return state();
};
let maxBridgeY = -Infinity;
const s1 = await holdUntil(["KeyW"], (s) => s.z < 18, 20000, (s) => { if (s.z < 25 && s.z > 21) maxBridgeY = Math.max(maxBridgeY, s.y); });
check("W で北（-Z）へ進み、橋を渡れる", s1.z < 18, `z ${s0.z.toFixed(2)} → ${s1.z.toFixed(2)}`);
check("橋の上で床面の高さに立つ", maxBridgeY > 0.3, `最大 y=${maxBridgeY.toFixed(2)}`);

// サエ家に向かって歩き続ける → 衝突で止まる
const s2 = await holdUntil(["KeyW"], () => false, 8000);
check("サエ家（中央）をすり抜けない", s2.z > 9.0 + 0.34 && s2.z < 9.6, `z=${s2.z.toFixed(3)}（壁面 z=9.0、半径 0.35）`);
await page.screenshot({ path: `${OUT}/shot-02-sae-front.png` });

// Shift + D で東へ（壁沿いに滑って）移動
const beforeRun = await state();
const s3 = await holdUntil(["ShiftLeft", "KeyD"], (s) => s.x > beforeRun.x + 5, 15000);
check("D で東（+X）へ移動（壁沿いに滑る）", s3.x > beforeRun.x + 5 && Math.abs(s3.z - beforeRun.z) < 1, `x ${beforeRun.x.toFixed(2)} → ${s3.x.toFixed(2)}`);

// マウスドラッグで視点回転
const yaw0 = (await state()).yaw;
await page.mouse.move(640, 360);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 20, 360 + i * 3);
await page.mouse.up();
await wait(500);
const yaw1 = (await state()).yaw;
check('ドラッグでカメラが回転する', Math.abs(yaw1 - yaw0) > 0.5, `yaw ${yaw0.toFixed(2)} → ${yaw1.toFixed(2)}`);

// ホイールでズーム
const camDist = async () => page.evaluate(() => {
  const g = window.__yui; const p = g.player; const c = g.camera.position;
  return Math.hypot(c.x - p.x, c.y - (p.y + 1.5), c.z - p.z);
});
// 開けた場所（広場）へ移動してから測る
await page.evaluate(() => { const p = window.__yui.player; p.x = 0; p.z = 16; });
await wait(800);
const d0 = await camDist();
for (let i = 0; i < 10; i++) { await page.mouse.wheel({ deltaY: 300 }); await wait(30); }
await wait(1200);
const d1 = await camDist();
for (let i = 0; i < 20; i++) { await page.mouse.wheel({ deltaY: -300 }); await wait(30); }
await wait(1200);
const d2 = await camDist();
check('ホイールでズームアウト／イン', d1 > d0 + 3 && d2 < d0 - 2, `距離 ${d0.toFixed(1)} → ${d1.toFixed(1)} → ${d2.toFixed(1)}`);
const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
check('ホイールでページがスクロールしない', scroll[0] === 0 && scroll[1] === 0);

// カメラの壁抜け防止：サエ家の正面に立ち、カメラを家側（北）に回す
await page.evaluate(() => {
  const g = window.__yui; const p = g.player; p.x = 0; p.z = 10.5;
  // yaw=0 → カメラはプレイヤーの北側＝家の中
  const o = g.cameraRig.orbit; o.yaw = o.targetYaw = 0; o.distance = o.targetDistance = 12; o.pitch = o.targetPitch = 0.3;
});
await wait(1000);
const camInHouse = await page.evaluate(() => {
  const c = window.__yui.camera.position;
  return { x: c.x, y: c.y, z: c.z };
});
// サエ家の躯体：x ±6, z ±8.4, 高さ ~5.8（scale 1.2）。屋根は更に上
const insideBody = Math.abs(camInHouse.x) < 6 && Math.abs(camInHouse.z) < 8.4 && camInHouse.y < 5.8;
check('カメラが建物の中に入り込まない', !insideBody, JSON.stringify(camInHouse));
await page.screenshot({ path: `${OUT}/shot-03-camera-collision.png` });
await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.targetYaw = Math.PI; o.targetPitch = 0.42; o.targetDistance = 10; });

// リサイズ
await page.setViewport({ width: 800, height: 600 });
await wait(800);
const rs = await page.evaluate(() => {
  const c = document.querySelector('#canvas-root canvas');
  return { cw: c.clientWidth, ch: c.clientHeight, aspect: window.__yui.camera.aspect };
});
check('画面リサイズに追従する', rs.cw === 800 && rs.ch === 600 && Math.abs(rs.aspect - 800 / 600) < 1e-6, JSON.stringify(rs));
await page.screenshot({ path: `${OUT}/shot-04-resized.png` });
await page.setViewport({ width: 1280, height: 720 });
await wait(500);

// 各地点の見た目確認用スクリーンショット
const views = [
  ['05-overview', 0, 26, Math.PI, 0.55, 22],
  ['06-isuke', 10, 4, Math.PI / 2 + 0.35, 0.4, 14],
  ['07-sohei', 0, -17, Math.PI, 0.35, 10],
  ['08-mine', -11, 8, -Math.PI / 2 - 0.5, 0.4, 13],
  ['09-bridge', 6, 31, Math.PI + 0.6, 0.3, 9],
];
for (const [name, x, z, yaw, pitch, dist] of views) {
  await page.evaluate((x, z, yaw, pitch, dist) => {
    const g = window.__yui; g.player.x = x; g.player.z = z;
    const o = g.cameraRig.orbit; o.yaw = o.targetYaw = yaw; o.pitch = o.targetPitch = pitch; o.distance = o.targetDistance = dist;
  }, x, z, yaw, pitch, dist);
  await wait(900);
  await page.screenshot({ path: `${OUT}/shot-${name}.png` });
}

// F3 デバッグ表示
await page.keyboard.press('F3');
await wait(800);
const debugText = await page.evaluate(() => document.querySelector('.hud-debug')?.textContent ?? '');
check('F3 でデバッグ表示', /FPS/.test(debugText), debugText.replace(/\n/g, ' / '));

// フォーカス喪失時にキーが押しっぱなしにならない
await page.keyboard.down('KeyW');
await wait(200);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const pb = await state();
await wait(600);
const pa = await state();
await page.keyboard.up('KeyW');
check('ウィンドウのフォーカスが外れたら移動が止まる', Math.hypot(pa.x - pb.x, pa.z - pb.z) < 0.6, `移動量 ${Math.hypot(pa.x - pb.x, pa.z - pb.z).toFixed(2)}`);

const errors = logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l));
const warnings = logs.filter((l) => /^\[warn/.test(l));
check('コンソールにエラーがない', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
console.log('\n--- console warnings ---\n' + (warnings.join('\n') || '(なし)'));
console.log('\n--- all console ---\n' + logs.join('\n'));
await browser.close();
await server.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
