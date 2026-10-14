/**
 * 見た目の確認用スクリーンショットと描画負荷の計測（Phase 5）。
 * 決まった視点・章・計画で撮影し、描画呼び出し数・三角形数・FPS を記録する。
 *
 *   npm run shots                 # ソフトウェア描画（SwiftShader）。FPS は実機の性能を表さない
 *   $env:GPU="1"; npm run shots   # GPU を使う（使えない環境では SwiftShader に戻る）
 *   $env:SHOTS_LABEL="before"     # 出力先 test-results/shots-<label>/
 *   $env:SHOTS_ONLY="ch1"         # 一部の場面だけ（ch1 / roofDay / ch3 / end / people）
 *
 * 結果は test-results/shots-<label>/stats.json にも保存する。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.env.SHOTS_LABEL ?? 'latest';
const OUT = path.join(ROOT, 'test-results', `shots-${LABEL}`);
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const only = process.env.SHOTS_ONLY?.split(',');
const want = (group) => !only || only.includes(group);

const server = await createServer({ root: ROOT, server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';

// FPS の上限（垂直同期）を外して、描画にかかる時間の余裕を測る
const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const swArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: [...(process.env.GPU ? gpuArgs : swArgs), '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await wait(2000);

const renderer = await page.evaluate(() => {
  const c = document.querySelector('#canvas-root canvas');
  const gl = c?.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});

// 調査用：SHOTS_EVAL の式をページ内で評価して表示し、終了する
if (process.env.SHOTS_EVAL) {
  console.log(JSON.stringify(await page.evaluate((src) => (0, eval)(src), process.env.SHOTS_EVAL), null, 1));
  console.log(logs.join('\n'));
  await browser.close();
  await server.close();
  process.exit(0);
}

/** 視点を置き、数フレーム待って撮影し、描画の統計を取る。 */
async function shot(name, v) {
  await page.evaluate((v) => {
    const g = window.__yui;
    g.placePlayerAt({ x: v.x, z: v.z, heading: v.heading ?? 0 });
    const o = g.cameraRig.orbit;
    o.yaw = o.targetYaw = v.yaw ?? v.heading ?? 0;
    o.pitch = o.targetPitch = v.pitch ?? 0.42;
    o.distance = o.targetDistance = v.dist ?? 10;
    // cam を指定したときは、追従カメラを止めて自由な位置から撮る（屋根の全体など）
    if (v.cam) {
      g.cameraRig.update = () => {
        g.camera.position.set(...v.cam.pos);
        g.camera.lookAt(...v.cam.look);
      };
    } else {
      delete g.cameraRig.update;
    }
    document.getElementById('hud').style.visibility = v.hideHud ? 'hidden' : '';
  }, v);
  await wait(v.settle ?? 900);
  const stats = await page.evaluate(async () => {
    const g = window.__yui;
    const info = g.renderer.info.render;
    const calls = info.calls;
    const triangles = info.triangles;
    const frames = await new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else resolve(n / ((performance.now() - t0) / 1000));
      };
      requestAnimationFrame(tick);
    });
    return { calls, triangles, fps: Math.round(frames) };
  });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  results.push({ name, ...stats });
  console.log(`${name.padEnd(28)} calls=${String(stats.calls).padStart(4)} tris=${String(stats.triangles).padStart(7)} fps=${stats.fps}`);
}

/** 第1幕の計画を状態だけで決める（tests/phase4.test.ts と同じ手順）。 */
async function decideRoof(plan) {
  await page.evaluate((plan) => {
    const g = window.__yui;
    const s = g.story;
    const learn = [
      ['sae.schedule', 'needsHelp'], ['sae.dateReason', 'burden'], ['sae.roof', 'worn'], ['sae.kaya', 'short'],
      ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'], ['isuke.pastHelp', 'isukeView'],
      ['sohei.schedule', 'kayaCutting'], ['mine.kaya', 'whyRecord'], ['mine.cutting', 'canLead'], ['ledger.basics', 'read'],
    ];
    for (const [t, st] of learn) s.learn(t, st);
    s.setPlanDraft(plan);
    for (const npc of s.planInvolved()) s.consultPlan(npc);
    if (!s.decidePlan()) throw new Error('計画を決められない：' + JSON.stringify(plan));
    g.noticeHandlers = {};
    g.dispatch('close');
  }, plan);
}

async function resetGame() {
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'load' });
  await wait(1500);
}

async function closeNotice() {
  await page.evaluate(() => {
    const g = window.__yui;
    if (g.mode === 'notice') {
      const ok = g.noticeHandlers.ok;
      g.dispatch('close');
      ok?.();
    }
  });
  await wait(300);
}

const results = [];
const PLANS = {
  'prep-full': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'solo-part': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'wait-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
  'waitHelp-part': { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'mineCovers' },
};

if (want('ch1')) {
  await shot('ch1-01-start', { x: 0, z: 31, heading: Math.PI });
  await shot('ch1-02-overview', { x: 0, z: 20, heading: Math.PI, pitch: 0.75, dist: 22 });
  await shot('ch1-03-sae-front', { x: 0, z: 15, heading: Math.PI, pitch: 0.3, dist: 12 });
  await shot('ch1-04-sae-side', { x: -12, z: 8, heading: Math.PI * 0.75, pitch: 0.35, dist: 10 });
  await shot('ch1-05-isuke', { x: 14, z: 4, heading: Math.PI * 0.62, pitch: 0.35, dist: 12 });
  await shot('ch1-06-field', { x: 30, z: 12, heading: Math.PI * 0.7, pitch: 0.4, dist: 12 });
  await shot('ch1-07-mine', { x: -12, z: 6, heading: -Math.PI * 0.55, pitch: 0.35, dist: 12 });
  await shot('ch1-08-sohei', { x: 0, z: -14, heading: Math.PI, pitch: 0.35, dist: 12 });
  await shot('ch1-09-bridge', { x: 6, z: 30, heading: Math.PI * 1.15, pitch: 0.3, dist: 9 });
  await shot('ch1-10-far', { x: 0, z: 38, heading: Math.PI, pitch: 0.22, dist: 20 });
  await shot('ch1-11-north', { x: 0, z: -30, heading: 0, pitch: 0.3, dist: 14 });
  await shot('ch1-12-roof-south', { x: 0, z: 26, heading: Math.PI, pitch: 0.12, dist: 22 });
  await shot('ch1-13-aerial', { x: 0, z: 10, heading: Math.PI * 0.9, pitch: 1.05, dist: 22 });
  await shot('ch1-14-isuke-far', { x: 6, z: 12, heading: Math.PI * 0.6, pitch: 0.2, dist: 16 });
  await shot('ch1-15-mine-far', { x: -8, z: 12, heading: -Math.PI * 0.65, pitch: 0.2, dist: 16 });
}

if (want('roof')) {
  // 屋根の見え方（南面の傷み・葺き替え）を確かめる視点
  await shot('roof-01-sae-south', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [-4, 9, 34], look: [-1, 7, 0] } });
  await shot('roof-02-sae-west', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [-26, 8, 20], look: [-2, 7, 0] } });
  await shot('roof-03-isuke', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [6, 7, 16], look: [24, 6, -6] } });
  await shot('roof-04-village', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [10, 26, 46], look: [0, 2, -6] } });
}

if (want('people')) {
  // 住民を順に正面から（立ち位置の 3m 手前）
  const npcs = await page.evaluate(() =>
    window.__yui.interaction.interactables.filter((i) => i.kind === 'npc').map((n) => ({ id: n.id, ...n.position, heading: n.heading })),
  );
  for (const n of npcs) {
    // 住民の正面 3.2m・目の高さから撮る（主人公は映さない）
    const hx = Math.sin(n.heading);
    const hz = Math.cos(n.heading);
    await shot(`people-${n.id}`, {
      x: n.x + hx * 6,
      z: n.z + hz * 6,
      hideHud: true,
      cam: { pos: [n.x + hx * 3.2, 1.6, n.z + hz * 3.2], look: [n.x, 1.1, n.z] },
    });
  }
  // 全員を並べて（色とシルエットの見分け）
  await page.evaluate(() => {
    const g = window.__yui;
    const ids = ['toki', 'sae', 'isuke', 'sohei', 'mine'];
    ids.forEach((id, i) => g.npcViews.get(id).setHome(-4 + i * 2, 14, 0, g.world.groundHeight(-4 + i * 2, 14)));
  });
  await shot('people-lineup', { x: 6, z: 14, heading: 0, hideHud: true, cam: { pos: [1.5, 1.8, 21], look: [0, 1.1, 14] } });
  await shot('people-lineup-far', { x: 6, z: 14, heading: 0, hideHud: true, cam: { pos: [1.5, 6, 34], look: [0, 1.1, 14] } });
}

if (want('roofDay')) {
  for (const [id, plan] of Object.entries(PLANS)) {
    await resetGame();
    await decideRoof(plan);
    await closeNotice();
    await shot(`roofDay-${id}-a`, { x: 0, z: 24, heading: Math.PI, pitch: 0.3, dist: 12 });
    await shot(`roofDay-${id}-b`, { x: 1.5, z: 16, heading: Math.PI, hideHud: true, cam: { pos: [-15, 10, 24], look: [-2, 4, 5] } });
    await shot(`roofDay-${id}-c`, { x: 1.5, z: 16, heading: Math.PI, hideHud: true, cam: { pos: [7, 4.5, 17], look: [-2, 2.5, 8] } });
  }
}

if (want('ch3') || want('end')) {
  await resetGame();
  await decideRoof(PLANS['solo-part']);
  await closeNotice();
  await page.evaluate(() => {
    const g = window.__yui;
    g.story.set('roofDay:ended');
    g.enterChapter3();
  });
  await wait(500);
  if (want('ch3')) {
    await shot('ch3-01-sae', { x: 0, z: 17, heading: Math.PI, pitch: 0.3, dist: 10 });
    await shot('ch3-03-sae-cane', { x: 0, z: 24, heading: Math.PI, hideHud: true, cam: { pos: [2.6, 1.6, 13.4], look: [3.4, 1.0, 10.6] } });
    await shot('ch3-04-roofs', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [10, 26, 46], look: [0, 2, -6] } });
    await shot('ch3-02-isuke', { x: 14, z: 4, heading: Math.PI * 0.62, pitch: 0.35, dist: 12 });
  }
  if (want('end')) {
    await page.evaluate(() => {
      const s = window.__yui.story;
      s.learn('sae.later', 'injured');
      s.setPlanDraft({ timing: 'now', saeHelp: 'ground' });
      for (const npc of s.planInvolved()) s.consultPlan(npc);
      s.decidePlan();
      window.__yui.dispatch('close');
    });
    await wait(500);
    await shot('end-e1-isuke', { x: 14, z: 4, heading: Math.PI * 0.62, pitch: 0.35, dist: 12 });
    await shot('end-e1-sae', { x: 0, z: 17, heading: Math.PI, pitch: 0.3, dist: 10 });
    await shot('end-e1-roofs', { x: 0, z: 30, heading: Math.PI, hideHud: true, cam: { pos: [6, 7, 16], look: [24, 6, -6] } });
  }
}

writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ renderer, results, logs }, null, 2));
console.log(`renderer: ${renderer}`);
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[warn'));
console.log(errors.length ? errors.join('\n') : 'console: no errors/warnings');
await browser.close();
await server.close();
