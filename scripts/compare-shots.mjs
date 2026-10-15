/**
 * Phase 6.5 の変更前後の比較用の撮影（同じ視点・同じ状態で撮る）。
 *
 *   node scripts/compare-shots.mjs before   → test-results/compare/before-*.png
 *   node scripts/compare-shots.mjs after    → test-results/compare/after-*.png
 *
 * ソフトウェア描画（SwiftShader）で撮る。テスト用に起動した Chrome だけを閉じる。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'after';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results', 'compare');
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = await createServer({ root: ROOT, server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2500);
  // タイトルを閉じて村へ（手引きは出さない）
  await page.evaluate(() => {
    const g = window.__yui;
    g.settingsStore?.update({ showHints: false, showControls: false });
    if (g.mode === 'title') g.dispatch('close');
    g.applySettings?.(g.settingsStore.value);
  });
  const shot = async (name, setup, ms = 1500) => {
    await page.evaluate(setup);
    await wait(ms);
    await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
    console.log(`${label}-${name}`);
  };
  const placeJs = (x, z, heading, yaw, pitch, dist) => `(() => {
    const g = window.__yui;
    g.placePlayerAt({ x: ${x}, z: ${z}, heading: ${heading} });
    const o = g.cameraRig.orbit;
    o.yaw = o.targetYaw = ${yaw};
    o.pitch = o.targetPitch = ${pitch};
    o.distance = o.targetDistance = ${dist};
  })()`;
  // 1. サエ家の前で、できるだけ上を見上げる（ドラッグで上へ動かしたのと同じ：上下角を下限まで）
  await shot('01-sae-lookup', `(() => {
    ${placeJs(-3, 11.5, Math.PI, Math.PI, 0.3, 8)};
    const g = window.__yui; const o = g.cameraRig.orbit;
    o.pitch = o.targetPitch = g.cameraRig.limits.minPitch;
  })()`);
  // 2. 開始直後の構図（屋根の見え方）
  await shot('02-sae-front-default', `(() => { const g = window.__yui; g.placePlayerAt({ x: -3, z: 13, heading: Math.PI }); })()`);
  // 3. 屋根を調べる（調査中の画面）
  await page.evaluate(() => { const g = window.__yui; g.placePlayerAt({ x: -4, z: 11.2, heading: Math.PI }); });
  await wait(600);
  await page.keyboard.press('KeyE');
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, `${label}-03-roof-inspect.png`) });
  console.log(`${label}-03-roof-inspect`);
  await page.keyboard.press('Escape');
  await wait(800);
  // 4. 宗平の作業場の正面と、中に入ろうとしたところ
  await shot('04-workshop-front', placeJs(0.5, -20.5, Math.PI, Math.PI, 0.25, 6));
  await page.evaluate(() => { const g = window.__yui; g.placePlayerAt({ x: 0.5, z: -22.5, heading: Math.PI }); const o = g.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; });
  await page.keyboard.down('KeyW');
  await wait(3500);
  await page.keyboard.up('KeyW');
  await wait(800);
  const pz = await page.evaluate(() => window.__yui.player.z.toFixed(2));
  await page.screenshot({ path: path.join(OUT, `${label}-05-workshop-walk-in.png`) });
  console.log(`${label}-05-workshop-walk-in z=${pz}`);
  // 6. 人物の近景（6 人）
  const people = [
    ['toki', 'トキ'],
    ['sae', 'サエ'],
    ['isuke', '伊助'],
    ['sohei', '宗平'],
    ['mine', 'ミネ'],
  ];
  for (const [id] of people) {
    await shot(`06-${id}`, `(() => {
      const g = window.__yui;
      const v = g.npcViews.get('${id}');
      const p = v.root.position; const h = v.root.rotation.y;
      g.placePlayerAt({ x: p.x + Math.sin(h) * 30, z: p.z + Math.cos(h) * 30, heading: 0 });
      g.cameraRig.update = () => {
        g.camera.position.set(p.x + Math.sin(h) * 2.6 + Math.cos(h) * 0.6, p.y + 1.5, p.z + Math.cos(h) * 2.6 - Math.sin(h) * 0.6);
        g.camera.lookAt(p.x, p.y + 1.05, p.z);
      };
    })()`);
  }
  await shot('06-player', `(() => {
    const g = window.__yui;
    g.placePlayerAt({ x: 0, z: 29, heading: 0 });
    const p = g.player;
    g.cameraRig.update = () => { g.camera.position.set(p.x + 0.6, p.y + 1.5, p.z + 2.6); g.camera.lookAt(p.x, p.y + 1.05, p.z); };
  })()`);
  // 7. 全員を並べて（村の人たちとの比較）
  await shot('07-lineup', `(() => {
    const g = window.__yui;
    const ids = ['toki', 'sae', 'isuke', 'sohei', 'mine'];
    ids.forEach((id, i) => { const v = g.npcViews.get(id); v.setHome(-4 + i * 2, 24.5 + 6, 0, g.world.groundHeight(-4 + i * 2, 30.5)); });
    g.placePlayerAt({ x: 6, z: 30.5, heading: 0 });
    g.cameraRig.update = () => { g.camera.position.set(1, 1.9, 36.5); g.camera.lookAt(1, 1.0, 30.5); };
  })()`);
  // 8. サエ家の軒下
  await shot('08-sae-eaves', `(() => {
    const g = window.__yui;
    delete g.cameraRig.update;
    g.placePlayerAt({ x: 4, z: 30, heading: 0 });
    g.cameraRig.update = () => { g.camera.position.set(-5.5, 1.7, 13.5); g.camera.lookAt(-3, 4.6, 6.5); };
  })()`);
} finally {
  await browser.close();
  await server.close();
}
