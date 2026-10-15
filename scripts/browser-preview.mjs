/**
 * 本番ビルド（dist/）での動作確認（Phase 8）。`vite preview` で dist を配信し、ヘッドレス Chrome で確かめる。
 *
 * 本番ビルドには開発用の window.__yui がないので、本番の画面は実際のキー・クリック・画面（DOM）だけで操作する。
 * 物語の途中の場面（屋根葺きの日を終えた後・第3幕で決める直前）は、開発サーバーで作った記録（localStorage）を
 * 本番の画面に入れ、「つづきから」で再開して、そこから先を本番の画面で進める。
 *
 *   npm run build && node scripts/browser-preview.mjs     （npm run test:preview）
 *
 * 公開 URL で確かめるときは PREVIEW_URL を指定する（vite preview は起動しない）。
 *   $env:PREVIEW_URL="https://yui-no-sato.vercel.app/"; node scripts/browser-preview.mjs
 *
 * テスト用に起動したブラウザだけを閉じる。既存の記録・設定（普段のブラウザ）には触れない。
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { keepAwake, watchClock } from './test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results', 'preview');
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SAVE_KEY = 'yui-no-yakusoku:save:1';
const SETTINGS_KEY = 'yui-no-yakusoku:settings:1';
const PREVIEW_URL = process.env.PREVIEW_URL;
if (!PREVIEW_URL && !existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.log('FAIL  dist/index.html がない（先に npm run build を実行する）');
  process.exit(1);
}
keepAwake();
const clock = watchClock();
const results = [];
let finishing = false;
const tally = () => `${results.filter((r) => r.startsWith('PASS')).length} PASS・${results.filter((r) => r.startsWith('FAIL')).length} FAIL`;
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = () =>
  puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });

// ───────── 1. 開発サーバーで、途中の場面の記録を作る ─────────
const fixtures = {};
{
  const dev = await createServer({ root: ROOT, server: { port: 5191, strictPort: false }, logLevel: 'error' });
  await dev.listen();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(dev.resolvedUrls.local[0], { waitUntil: 'networkidle0' });
    for (let i = 0; i < 150 && !(await page.evaluate(() => window.__yui?.mode === 'title')); i++) await wait(100);
    const made = await page.evaluate((SAVE_KEY) => {
      const g = window.__yui;
      const s = g.story;
      g.resetToNewGame();
      for (const [t, v] of [
        ['sae.schedule', 'needsHelp'], ['sae.dateReason', 'burden'], ['sae.roof', 'worn'], ['sae.kaya', 'short'],
        ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'], ['isuke.pastHelp', 'isukeView'],
        ['sohei.schedule', 'kayaCutting'], ['mine.kaya', 'whyRecord'], ['mine.cutting', 'canLead'], ['ledger.basics', 'read'],
      ]) s.learn(t, v);
      // 第1幕：前日の準備・手持ちの茅（prep-part）。屋根葺きの日にサエと話して一日を終えた直後
      s.setPlanDraft({ date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' });
      for (const npc of s.planInvolved()) s.consultPlan(npc);
      s.decidePlan({ source: '作業台で決めた' });
      s.learn('sae.roof', 'partial');
      s.set('roofDay:ended');
      Object.assign(g.player, { x: 3.4, z: 12.4, heading: Math.PI });
      g.saveGame();
      const roofEnded = localStorage.getItem(SAVE_KEY);
      // 第3幕：伊助家の屋根葺き。下の仕事を頼む案に二人とも承諾し、作業台の前にいる（決める直前）
      g.enterChapter3();
      s.learn('isuke.roof3', 'needsRoof');
      s.learn('sae.later', 'injured');
      s.setPlanDraft({ timing: 'now', saeHelp: 'ground' });
      for (const npc of s.planInvolved()) s.consultPlan(npc);
      const phase = s.planPhase();
      Object.assign(g.player, { x: 4.5, z: -18.4, heading: Math.PI });
      g.saveGame();
      return { roofEnded, ch3Ready: localStorage.getItem(SAVE_KEY), phase };
    }, SAVE_KEY);
    check('[準備] 開発サーバーで途中の場面の記録を作れる（第3幕は全員承諾）', !!made.roofEnded && !!made.ch3Ready && made.phase === 'ready', `phase=${made.phase}`);
    fixtures.roofEnded = made.roofEnded;
    fixtures.ch3Ready = made.ch3Ready;
  } finally {
    await browser.close().catch(() => undefined);
    await dev.close().catch(() => undefined);
  }
}

// ───────── 2. 本番ビルドを配信して確かめる ─────────
const server = PREVIEW_URL ? null : await preview({ root: ROOT, preview: { port: 4179, strictPort: false }, logLevel: 'error' });
const url = PREVIEW_URL ? new URL(PREVIEW_URL).href : (server.resolvedUrls?.local[0] ?? 'http://localhost:4179/');
if (PREVIEW_URL) console.log(`公開 URL で確かめる：${url}`);
const browser = await launch();
browser.on('disconnected', () => {
  if (finishing) return;
  finishing = true;
  console.log(`\nCRASH: テスト用のブラウザとの接続が切れた（${tally()} まで）。${clock.describe()}`);
  if (server) server.httpServer.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000);
});
const logs = [];
const responses = [];
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('error', (e) => logs.push(`[pageerror] ページがクラッシュした：${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));

/** 画面の状態を DOM だけから読む（本番には __yui がない）。 */
const ui = () =>
  page.evaluate(() => {
    const vis = (s) => [...document.querySelectorAll(s)].some((e) => !e.hidden && e.getClientRects().length > 0);
    const text = (s) => document.querySelector(s)?.textContent ?? '';
    const layers = [...document.querySelectorAll('.overlay-layer')].filter((e) => !e.hidden).map((e) => e.className.replace('overlay-layer', '').trim());
    const prompt = document.querySelector('.interaction-prompt');
    return {
      layers,
      dialogue: vis('.dialogue-layer .dialogue-box') && !document.querySelector('.dialogue-layer')?.hidden,
      speaker: text('.dialogue-name'),
      line: text('.dialogue-text'),
      choices: [...document.querySelectorAll('.dialogue-choices button')].map((b) => b.textContent),
      prompt: prompt && !prompt.hidden ? prompt.textContent : '',
      objective: text('.hud-objective-text'),
      titleStatus: text('.title-status'),
      titleItems: [...document.querySelectorAll('.title-item')].map((b) => `${b.dataset.id}${b.disabled ? ':disabled' : ''}`),
      hudTitleMode: document.getElementById('hud')?.classList.contains('is-title') ?? false,
      loading: !!document.getElementById('loading'),
      canvas: !!document.querySelector('#canvas-root canvas'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
const waitUi = async (cond, ms = 15000) => {
  const t0 = Date.now();
  let u = await ui();
  while (!cond(u) && Date.now() - t0 < ms) {
    await wait(150);
    u = await ui();
  }
  return u;
};
const has = (u, layer) => u.layers.some((l) => l.split(' ').includes(layer));
/** 時間経過の画面・短い演出を決定キーで進め、村（探索）に出るまで。 */
const toVillage = async () => {
  for (let i = 0; i < 60; i++) {
    const u = await ui();
    if (has(u, 'transition-layer') || u.hudTitleMode) {
      await page.keyboard.press('Enter');
      await wait(300);
    } else if (u.layers.length === 0) return u;
    else await wait(150);
  }
  return ui();
};
const clickTitle = async (id) => {
  await waitUi((u) => has(u, 'title-layer'));
  await page.click(`.title-layer .title-item[data-id="${id}"]`);
  await wait(300);
};
/** 会話を最後まで進める（選択肢は先頭を選ぶ。押すたびに表示が変わるまで待つ）。 */
const finishDialogue = async () => {
  for (let i = 0; i < 80; i++) {
    const u = await ui();
    if (!u.dialogue) return true;
    const before = `${u.line}|${u.choices.length}`;
    await page.keyboard.press(u.choices.length > 0 ? 'Digit1' : 'Enter');
    await waitUi((n) => !n.dialogue || `${n.line}|${n.choices.length}` !== before, 3000);
  }
  return !(await ui()).dialogue;
};

// 起動
await page.goto(url, { waitUntil: 'networkidle0' });
const boot = await waitUi((u) => has(u, 'title-layer') && !u.loading);
check('[起動] タイトル画面が出て、読み込み表示が消える', has(boot, 'title-layer') && !boot.loading && boot.canvas, JSON.stringify({ layers: boot.layers, canvas: boot.canvas }));
const assets = responses.filter((r) => r.url.startsWith(url));
check('[起動] 読み込んだファイルがすべて 200 番台（404 などがない）', assets.length > 0 && assets.every((r) => r.status < 400), assets.map((r) => `${r.status} ${r.url.slice(url.length - 1)}`).join(', '));
check('[起動] JS・CSS を相対パスの assets/ から読む', assets.some((r) => /\/assets\/index-[^/]+\.js$/.test(r.url)) && assets.some((r) => /\/assets\/index-[^/]+\.css$/.test(r.url)));
check('[起動] 外部のサーバーへの通信がない', responses.every((r) => r.url.startsWith(url) || r.url.startsWith('data:')), responses.filter((r) => !r.url.startsWith(url)).map((r) => r.url).join(', '));
const devHook = await page.evaluate(() => typeof window.__yui);
check('[起動] 本番ビルドに開発用の window.__yui がない', devHook === 'undefined', devHook);
const files = await page.evaluate(async () => {
  const get = async (p) => {
    const r = await fetch(p);
    return { status: r.status, text: r.ok ? await r.text() : '' };
  };
  const lic = await get('THIRD_PARTY_LICENSES.txt');
  const fav = await get('favicon.svg');
  return { lic: lic.status, licOk: lic.text.includes('three.js authors') && lic.text.includes('Permission is hereby granted'), fav: fav.status };
});
check('[起動] THIRD_PARTY_LICENSES.txt と favicon.svg が配信される', files.lic === 200 && files.licOk && files.fav === 200, JSON.stringify(files));
await page.screenshot({ path: `${OUT}/01-title.png` });

// はじめから → 導入 → 村
await page.evaluate(() => localStorage.clear()); // テスト用ブラウザの記録だけ
await page.reload({ waitUntil: 'networkidle0' });
await clickTitle('new');
const v1 = await toVillage();
check('[操作] 「はじめから」で導入を経て村に出る', v1.layers.length === 0 && !v1.hudTitleMode, JSON.stringify(v1.layers));

// ゲーム内の時間を、ゲームと同じ数え方（1 フレーム最大 0.1 秒）で測る（本番には __yui がないため）
await page.evaluate(() => {
  window.__gameTime = 0;
  let last = performance.now();
  const tick = (now) => {
    window.__gameTime += Math.min(0.1, (now - last) / 1000);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const gameTime = () => page.evaluate(() => window.__gameTime);
/** キーを押し続け、条件を満たすか、ゲーム内で seconds 秒たつまで待つ。 */
const holdFor = async (keys, seconds, cond = () => false) => {
  for (const k of keys) await page.keyboard.down(k);
  const g0 = await gameTime();
  const t0 = Date.now();
  let u = await ui();
  while (!cond(u) && (await gameTime()) - g0 < seconds && Date.now() - t0 < 120000) {
    await wait(80);
    u = await ui();
  }
  for (const k of keys) await page.keyboard.up(k);
  await wait(300);
  return ui();
};
// スタート（橋の南、z=31）から W で北へ約 12m（歩き 4.2m/s で約 3 秒）、橋を渡って広場へ。そこから A で西のトキへ
await holdFor(['KeyW'], 2.9, (u) => u.prompt.includes('トキ'));
const near = await holdFor(['KeyA'], 3, (u) => u.prompt.includes('トキ'));
check('[操作] W・A で歩いて橋を渡り、トキの前で「E 話す」の案内が出る', near.prompt.includes('トキ'), near.prompt);
await page.keyboard.press('KeyE');
const talk = await waitUi((u) => u.dialogue, 8000);
check('[操作] E でトキと話せる（会話の画面に名前と台詞が出る）', talk.dialogue && talk.speaker.includes('トキ') && talk.line.length > 0, `${talk.speaker}：${talk.line.slice(0, 40)}`);
await page.screenshot({ path: `${OUT}/02-dialogue.png` });
const ended = await finishDialogue();
const afterTalk = await waitUi((u) => !u.dialogue);
check('[操作] Enter・数字キーで会話を最後まで進めて、村に戻る', ended && afterTalk.layers.length === 0);
await wait(1500);

// 手帳（Tab）・ポーズ（Esc）・記録
await page.keyboard.press('Tab');
const nb = await waitUi((u) => has(u, 'notebook-layer'), 5000);
const nbText = await page.evaluate(() => document.querySelector('.notebook-layer')?.textContent ?? '');
// 手帳は「分かったこと」の区分で開く。会ったトキは「人物」の区分に数えられる
check('[操作] Tab で手帳が開き、会ったトキが「人物」に数えられている', has(nb, 'notebook-layer') && nbText.includes('人物（1）'), `${JSON.stringify(nb.layers)} ${nbText.slice(0, 60)}`);
await page.keyboard.press('Tab');
await waitUi((u) => u.layers.length === 0, 5000);
await page.keyboard.press('Escape');
const pz = await waitUi((u) => has(u, 'pause-layer'), 5000);
check('[操作] Esc でポーズ画面が開く', has(pz, 'pause-layer'));
await page.click('.pause-layer .menu-item[data-id="save"]');
await wait(500);
const saved = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
check('[記録] ポーズ画面の「記録する」で保存される', !!saved && JSON.parse(saved).version === 3, saved ? `version ${JSON.parse(saved).version}` : 'なし');
await page.keyboard.press('Escape');
await waitUi((u) => u.layers.length === 0, 5000);
await page.keyboard.press('KeyM'); // 音を消す（設定に保存される）
// キーはフレームごとに読むので、描画が遅いと 0.5 秒では反映されないことがある（2026-10-16 に 1 回失敗）。保存されるまで待つ
const mutedSaved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').muted === true, SETTINGS_KEY);
for (let i = 0; i < 100 && !(await mutedSaved()); i++) await wait(100);

// 再読み込み → つづきから。設定も残る
await page.reload({ waitUntil: 'networkidle0' });
const t2 = await waitUi((u) => has(u, 'title-layer') && !u.loading);
const settings = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SETTINGS_KEY);
check('[記録] 再読み込み後、タイトルで「つづきから」を選べて、前回の記録が出る', t2.titleItems.includes('continue') && t2.titleStatus.includes('前回の記録'), t2.titleStatus);
check('[記録] 設定（音を消す）が再読み込み後も残る', settings.muted === true, JSON.stringify({ muted: settings.muted }));
await clickTitle('continue');
const v2 = await toVillage();
check('[記録] 「つづきから」で村に戻れる', v2.layers.length === 0 && !v2.hudTitleMode);

// 壊れた記録
await page.evaluate((k) => localStorage.setItem(k, '{壊れた記録'), SAVE_KEY);
await page.reload({ waitUntil: 'networkidle0' });
const t3 = await waitUi((u) => has(u, 'title-layer') && !u.loading);
const quarantined = await page.evaluate((k) => ({ main: localStorage.getItem(k), corrupt: localStorage.getItem(`${k}:corrupt`) }), SAVE_KEY);
check('[記録] 壊れた記録は読み込まず、案内を出し、消さずに別名で残す', t3.titleItems.includes('continue:disabled') && t3.titleStatus.includes('壊れていた') && quarantined.main === null && quarantined.corrupt === '{壊れた記録', t3.titleStatus);

// 屋根葺きの日を終えた直後の記録 → 結果画面が戻る → 三年後へ
await page.evaluate((k, v) => { localStorage.removeItem(`${k}:corrupt`); localStorage.setItem(k, v); }, SAVE_KEY, fixtures.roofEnded);
await page.reload({ waitUntil: 'networkidle0' });
await clickTitle('continue');
const res = await waitUi((u) => has(u, 'result-layer'), 15000);
const resText = await page.evaluate(() => document.querySelector('.result-layer')?.textContent ?? '');
check('[進行] 屋根葺きの日を終えた記録から再開すると、結果画面が出る', has(res, 'result-layer') && resText.length > 50, resText.slice(0, 60));
await page.screenshot({ path: `${OUT}/03-result.png` });
await page.keyboard.press('Enter');
const later = await waitUi((u) => has(u, 'transition-layer'), 8000);
const laterText = await page.evaluate(() => document.querySelector('.transition-layer')?.textContent ?? '');
check('[進行] 結果画面を閉じると「三年後の秋」になる', has(later, 'transition-layer') && laterText.includes('三年後'), laterText.slice(0, 40));
const v3 = await toVillage();
check('[進行] 三年後の村に出られる', v3.layers.length === 0 && !v3.hudTitleMode, v3.objective);

// 第3幕：作業台で決める → エンディング
await page.evaluate((k, v) => localStorage.setItem(k, v), SAVE_KEY, fixtures.ch3Ready);
await page.reload({ waitUntil: 'networkidle0' });
await clickTitle('continue');
await toVillage();
const atTable = await waitUi((u) => u.prompt.includes('作業台'), 10000);
check('[進行] 第3幕の作業台の前で案内が出る', atTable.prompt.includes('作業台'), atTable.prompt);
await page.keyboard.press('KeyE');
let plan = await waitUi((u) => has(u, 'plan-layer') || u.dialogue, 8000);
if (plan.dialogue) {
  await finishDialogue();
  plan = await waitUi((u) => has(u, 'plan-layer'), 8000);
}
check('[進行] 作業台（伊助家の屋根葺きの段取り）が開く', has(plan, 'plan-layer'));
await page.screenshot({ path: `${OUT}/04-plan.png` });
await page.click('.plan-layer .plan-decide');
await waitUi((u) => has(u, 'notice-layer'), 5000);
await page.click('.notice-layer .menu-item[data-id="yes"]');
const end = await waitUi((u) => has(u, 'ending-layer'), 10000);
const endText = await page.evaluate(() => document.querySelector('.ending-layer')?.textContent ?? '');
check('[進行] 決めるとエンディング（E1 つながる約束）になる', has(end, 'ending-layer') && endText.includes('つながる約束'), endText.slice(0, 50));
check('[進行] エンディングに、第1幕で一部だけ葺いた場合の新しい約束が出る', endText.includes('サエ家の屋根の残りを葺くときは、伊助家が手を貸す'));
await page.screenshot({ path: `${OUT}/05-ending.png` });
await page.keyboard.press('Enter');
const back = await waitUi((u) => u.layers.length === 0, 8000);
check('[進行] エンディングの後、村に戻れる', back.layers.length === 0);

// 画面サイズ：タイトルと村で、横にはみ出さない
for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 640], [638, 572]]) {
  await page.setViewport({ width: w, height: h });
  await wait(800);
  const inGame = await ui();
  await page.screenshot({ path: `${OUT}/size-${w}x${h}-village.png` });
  const box = await page.evaluate(() => {
    const r = document.querySelector('.hud-objective')?.getBoundingClientRect();
    return r ? { right: r.right, bottom: r.bottom } : null;
  });
  check(`[画面] ${w}×${h}：村の画面が横にはみ出さず、右上の目的が画面内に収まる`, !inGame.overflowX && !!box && box.right <= w + 1 && box.bottom <= h + 1, JSON.stringify(box));
}
await page.setViewport({ width: 1280, height: 720 });

const errors = logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l));
const warnings = logs.filter((l) => /^\[warn/.test(l));
check('[品質] コンソールにエラーがない', errors.length === 0, errors.join(' | '));
check('[品質] コンソールに警告がない', warnings.length === 0, warnings.join(' | '));
finishing = true;
console.log(`\n合計：${tally()}。${clock.describe()}`);
console.log(`スクリーンショット：${path.relative(ROOT, OUT)}`);
await browser.close();
server?.httpServer.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
