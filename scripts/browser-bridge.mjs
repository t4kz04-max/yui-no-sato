/**
 * 橋の通行だけを確かめる短いブラウザテスト（Phase 8。フルテストの約 20 分に対して数分）。
 *
 * 2026-10-15 のフルテストで「橋の出口から入口まで歩いて渡れる（北→南）」が z=27.44 で失敗した。
 * 調べると、橋は渡り終えていて（橋の南端は z=26.2）、実時間 20 秒の制限内に z>28 へ届かなかっただけだった。
 * ゲームの 1 フレームで進む時間は 0.1 秒までなので、描画が遅い（並行して重い処理が走る）と
 * ゲーム内の時間は実時間よりずっと遅く進む。このテストは次を確かめる。
 *
 * - 南→北・北→南を、キーを押し続けて実際に歩かせる。端寄り（欄干の近く）も歩く。
 * - 判定はゲーム内で歩いた時間（Game の clock）で行う。
 * - CPU を 4 倍遅くした状態（Chrome の CPU スロットリング）でも同じ結果になる（失敗時の状況の再現）。
 * - 0.5 秒（ゲーム内）以上ほとんど動かない所があれば、引っかかりとして失敗にする。
 *
 *   node scripts/browser-bridge.mjs
 *
 * テスト用に起動したブラウザだけを閉じる。
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { keepAwake, watchClock } from './test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
keepAwake();
const clock = watchClock();
const server = await createServer({ root: ROOT, server: { port: 5193, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5193/';
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const results = [];
const logs = [];
let finishing = false;
const tally = () => `${results.filter((r) => r.startsWith('PASS')).length} PASS・${results.filter((r) => r.startsWith('FAIL')).length} FAIL`;
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};
const finish = async (code) => {
  if (finishing) return;
  finishing = true;
  console.log(`\n合計：${tally()}。${clock.describe()}`);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  process.exit(code);
};
browser.on('disconnected', () => {
  if (finishing) return;
  check('テスト用のブラウザが最後まで動く', false, `途中で接続が切れた。${clock.describe()}`);
  finishing = true;
  server.close().finally(() => process.exit(1));
});
process.on('uncaughtException', (e) => {
  check('例外なく最後まで進む', false, String(e?.stack ?? e));
  void finish(1);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('error', (e) => logs.push(`[pageerror] ページがクラッシュした：${e.message}`));

await page.goto(url, { waitUntil: 'networkidle0' });
const gameMode = () => page.evaluate(() => window.__yui?.mode ?? null);
for (let i = 0; i < 150 && (await gameMode()) !== 'title'; i++) await wait(100);
await page.click('.title-layer .title-item[data-id="new"]');
for (let i = 0; i < 60; i++) {
  const m = await gameMode();
  if (m === 'notice') await page.click('.notice-layer .menu-item[data-id="yes"]');
  else if (m === 'transition' || m === 'cinematic') await page.keyboard.press('Enter');
  else if (m === 'explore') break;
  await wait(250);
}
check('探索を始められる', (await gameMode()) === 'explore');

/** 位置・ゲーム内の時間（Game の clock：毎フレームの dt の合計）・描画したフレーム数。 */
await page.evaluate(() => {
  window.__frames = 0;
  const tick = () => {
    window.__frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const sample = () =>
  page.evaluate(() => ({ x: window.__yui.player.x, z: window.__yui.player.z, t: window.__yui.clock, f: window.__frames }));
const place = (x, z) =>
  page.evaluate((x, z) => {
    const g = window.__yui;
    Object.assign(g.player, { x, z, heading: Math.PI, velocityX: 0, velocityZ: 0 });
    const o = g.cameraRig.orbit;
    o.yaw = o.targetYaw = Math.PI; // 北（-Z）を向く
  }, x, z);

/** キーを押し続け、条件を満たすか、ゲーム内で gameSeconds 秒歩くまで待つ（実時間の上限は止まったとき用）。 */
const walk = async (key, cond, gameSeconds = 8, realLimitMs = 180000) => {
  const start = await sample();
  const t0 = Date.now();
  const track = [start];
  await page.keyboard.down(key);
  let s = start;
  while (!cond(s) && s.t - start.t < gameSeconds && Date.now() - t0 < realLimitMs) {
    await wait(100);
    s = await sample();
    track.push(s);
  }
  await page.keyboard.up(key);
  await wait(300);
  const end = await sample();
  const realSec = (Date.now() - t0) / 1000;
  // ゲーム内で 0.5 秒以上、0.2m も動かなかった区間（引っかかり）。条件を満たした後は数えない
  let stuck = null;
  for (let i = 0; i < track.length && !stuck; i++) {
    if (cond(track[i])) break;
    const j = track.findIndex((u, k) => k > i && u.t - track[i].t >= 0.5);
    if (j > 0 && Math.hypot(track[j].x - track[i].x, track[j].z - track[i].z) < 0.2) stuck = track[i];
  }
  return { start, end, realSec, gameSec: end.t - start.t, fps: (end.f - start.f) / realSec, stuck };
};
const fmt = (r) =>
  `z ${r.start.z.toFixed(2)} → ${r.end.z.toFixed(2)}、x=${r.end.x.toFixed(2)}、実時間 ${r.realSec.toFixed(1)} 秒・ゲーム内 ${r.gameSec.toFixed(2)} 秒・${r.fps.toFixed(1)} fps` +
  (r.stuck ? `、止まった位置 (${r.stuck.x.toFixed(2)}, ${r.stuck.z.toFixed(2)})` : '');

const cdp = await page.createCDPSession();
for (const [label, rate] of [['通常', 1], ['CPU 4 倍遅く', 4]]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await place(0, 29);
  await wait(500);
  const north = await walk('KeyW', (s) => s.z < 17.5);
  check(`[橋・${label}] 入口から出口まで（南→北、z<17.5）渡れる`, north.end.z < 17.5 && !north.stuck, fmt(north));
  const south = await walk('KeyS', (s) => s.z > 28);
  check(`[橋・${label}] 出口から入口まで（北→南、z>28）渡れる`, south.end.z > 28 && !south.stuck, fmt(south));
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
// 欄干の近く（端寄り）を歩いても引っかからない
for (const x of [-0.9, 0.9]) {
  for (const [key, from, cond, dir] of [
    ['KeyS', 17, (s) => s.z > 28, '北→南'],
    ['KeyW', 29, (s) => s.z < 17.5, '南→北'],
  ]) {
    await place(x, from);
    await wait(400);
    const r = await walk(key, cond);
    check(`[橋・端寄り x=${x}] ${dir}に渡れる`, cond(r.end) && !r.stuck, fmt(r));
  }
}
const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
check('コンソールにエラーがない', errors.length === 0, errors.join(' / '));
await finish(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
