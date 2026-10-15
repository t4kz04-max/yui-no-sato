/**
 * カメラの遮蔽の計測（Phase 7・H01）。第三者プレイテストで報告された場所に主人公を置き、
 * 通常のカメラ距離で 1 周（24 方向）見回したとき、
 *  - occluded：主人公の胸・頭がカメラから見えない（物に隠れる）方向の数
 *  - blocked：カメラのすぐ前（0.6m 以内）を物がふさぐ方向の数（画面の大部分が物で覆われる）
 * を数える。修正の前後で比べるための開発用スクリプト。
 *
 *   node scripts/camera-occlusion.mjs [ラベル]   → test-results/camera-occlusion-<ラベル>.json
 *
 * ソフトウェア描画（SwiftShader）で動かす。テスト用に起動した Chrome だけを閉じる。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'now';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = await createServer({ root: ROOT, server: { port: 5196, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 報告された場所（と、比べるための開けた場所）
const SPOTS = [
  { id: 'open-plaza', x: 0, z: 16, indoor: false },
  { id: 'sae-irori-to-shelf', x: 0.6, z: -3.2, indoor: true },
  { id: 'sae-irori-side', x: -1.6, z: -2.2, indoor: true },
  { id: 'workshop-door', x: 0.2, z: -24.2, indoor: false },
  { id: 'workshop-inside-corner', x: -3.1, z: -25.4, indoor: false },
  { id: 'workshop-outside-corner', x: -4.6, z: -23.6, indoor: false },
  { id: 'workshop-outside-side', x: 4.7, z: -27, indoor: false },
  { id: 'isuke-house-field', x: 33.5, z: 4.5, indoor: false },
];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2500);
  const results = await page.evaluate((spots) => {
    const g = window.__yui;
    if (g.mode === 'title') g.dispatch('close');
    g.loop.stop();
    const V = g.camera.position.constructor;
    const raycaster = new (g.cameraRig.raycaster.constructor)();
    const out = [];
    for (const s of spots) {
      g.setIndoorMode(s.indoor);
      g.placePlayerInPlace({ x: s.x, z: s.z, heading: 0 });
      g.updateCameraZone();
      const targets = g.scene.children.filter((o) => o.name !== 'player' && o.visible);
      let occluded = 0;
      let blocked = 0;
      const minDist = [];
      const by = new Set();
      for (let i = 0; i < 24; i++) {
        const yaw = (i / 24) * Math.PI * 2;
        const o = g.cameraRig.orbit;
        o.yaw = o.targetYaw = yaw;
        g.cameraRig.reset(yaw);
        for (let f = 0; f < 45; f++) g.cameraRig.update(g.player, { lookX: 0, lookY: 0, zoom: 0 }, 1 / 30);
        g.scene.updateMatrixWorld(true);
        const cam = g.camera.position.clone();
        minDist.push(g.cameraRig.currentDistance);
        // 胸・頭が見えるか
        let hidden = 0;
        for (const h of [1.0, 1.55]) {
          const p = new V(g.player.x, g.player.y + h, g.player.z);
          const dir = p.clone().sub(cam);
          const len = dir.length();
          raycaster.set(cam, dir.normalize());
          raycaster.far = len - 0.35;
          const hit = raycaster.intersectObjects(targets, true).find((x) => x.object.visible && x.object.name !== 'contact-shadow' && !x.object.isSprite);
          if (hit) {
            hidden++;
            let n = hit.object;
            while (n && !n.name && n.parent) n = n.parent;
            by.add(`${n?.name || '?'}(${hit.object.geometry?.type ?? ''})@${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}`);
          }
        }
        if (hidden === 2) occluded++;
        // カメラのすぐ前をふさぐ物
        const d = new V();
        g.camera.getWorldDirection(d);
        raycaster.set(cam, d);
        raycaster.far = 0.6;
        raycaster.near = 0.1;
        if (raycaster.intersectObjects(targets, true).some((x) => x.object.visible && x.object.name !== 'player')) blocked++;
        raycaster.near = 0;
      }
      out.push({ id: s.id, occluded, blocked, minCameraDistance: Math.min(...minDist).toFixed(2), by: [...by].slice(0, 6).join(' ') });
    }
    g.setIndoorMode(false);
    return out;
  }, SPOTS);
  console.table(results);
  writeFileSync(path.join(OUT, `camera-occlusion-${label}.json`), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}
