/**
 * 結果画面・章の境目での記録の復元（Phase 7 最終品質改善・レビュー指摘 #1）。
 * 全 8 案について、屋根葺きの日にサエと話して「一日を終える」→ 結果画面で再読み込み → 「つづきから」で、
 * 結果画面が戻り、第3幕へ進めることを確かめる。1 つの案では、一日を終える前・第3幕に入った直後の復元も確かめる。
 *
 *   node scripts/browser-resume.mjs      （npm run test:browser の後半でも実行する）
 *
 * テスト用に起動した Chrome だけを閉じる。
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { keepAwake, watchClock } from './test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// テストの実行中だけスリープを抑え、PC が止まっていた時間を記録する（Phase 8）
keepAwake();
const clock = watchClock();
const server = await createServer({ root: ROOT, server: { port: 5195, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
const results = [];
const logs = [];
let finishing = false;
const tally = () => `${results.filter((r) => r.startsWith('PASS')).length} PASS・${results.filter((r) => r.startsWith('FAIL')).length} FAIL`;
// テスト用のブラウザが途中で終わったら、成功扱いにせず終える
browser.on('disconnected', () => {
  if (finishing) return;
  finishing = true;
  console.log(`\nCRASH: テスト用のブラウザとの接続が切れた（${tally()} まで）。${clock.describe()}`);
  server.close().finally(() => process.exit(1));
});
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  results.push(line);
  // 途中で止まったときに、どこまで進んだか分かるように逐次出す（Phase 8）
  console.log(line);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PLANS = {
  'solo-full': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'solo-part': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'prep-full': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'prep-part': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'wait-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
  'wait-part': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'mineCovers' },
  'waitHelp-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
  'waitHelp-part': { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'own', kayaReturn: 'none', soheiCover: 'mineCovers' },
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const url = server.resolvedUrls.local[0];
  const st = () =>
    page.evaluate(() => {
      const g = window.__yui;
      return g ? { mode: g.mode, chapter: g.story.chapter, ended: g.story.has('roofDay:ended'), active: g.interaction.isActive, choices: (g.interaction.view?.choices ?? []).map((c) => c.text), text: g.interaction.view?.text ?? '' } : null;
    });
  const waitFor = async (cond, ms = 10000) => {
    const t0 = Date.now();
    let s = await st();
    while (!(s && cond(s)) && Date.now() - t0 < ms) {
      await wait(150);
      s = await st();
    }
    return s;
  };
  /** 時間経過の画面と短い演出を、画面の変化を確かめながら進める。 */
  const skipScenes = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await st();
      if (s && (s.mode === 'transition' || s.mode === 'cinematic')) {
        await page.keyboard.press('Enter');
        await wait(350);
      } else if (s) return s;
      else await wait(150);
    }
    return st();
  };
  const reloadTo = async (choice) => {
    await page.reload({ waitUntil: 'networkidle0' });
    await waitFor((s) => s.mode === 'title', 15000);
    await page.click(`.title-layer .title-item[data-id="${choice}"]`);
    await wait(300);
    if (choice === 'new' && (await st())?.mode === 'notice') await page.click('.notice-layer .menu-item[data-id="yes"]');
    await skipScenes();
  };
  const decide = (plan) =>
    page.evaluate((plan) => {
      const g = window.__yui;
      const s = g.story;
      for (const [t, v] of [
        ['sae.schedule', 'needsHelp'], ['sae.dateReason', 'burden'], ['sae.roof', 'worn'], ['sae.kaya', 'short'],
        ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'], ['isuke.pastHelp', 'isukeView'],
        ['sohei.schedule', 'kayaCutting'], ['mine.kaya', 'whyRecord'], ['mine.cutting', 'canLead'], ['ledger.basics', 'read'],
      ]) s.learn(t, v);
      s.setPlanDraft(plan);
      for (const npc of s.planInvolved()) s.consultPlan(npc);
      g.decidePlan();
      return s.outcome() ?? null;
    }, plan);
  /** サエの前に立って話し、「一日を終える」を選ぶ（選ばずに会話を閉じることもできる）。 */
  const endDayWithSae = async (pick = '一日を終える') => {
    await page.evaluate(() => {
      const g = window.__yui;
      Object.assign(g.player, { x: 3.4, z: 12.4, heading: Math.PI, velocityX: 0, velocityZ: 0 });
    });
    await waitFor((s) => s.mode === 'explore');
    for (let i = 0; i < 30 && !(await page.evaluate(() => window.__yui.interaction.target?.id === 'sae')); i++) await wait(150);
    await page.keyboard.press('KeyE');
    await waitFor((s) => s.active, 5000);
    // 低 FPS でも 1 回ずつ確実に進めるよう、押すたびに表示が変わるまで待つ
    for (let i = 0; i < 80; i++) {
      const s = await st();
      if (!s.active) break;
      const before = `${s.text}|${s.choices.length}`;
      if (s.choices.length > 0) {
        const idx = s.choices.findIndex((c) => c.includes(pick));
        await page.keyboard.press(`Digit${idx >= 0 ? idx + 1 : s.choices.length}`);
      } else await page.keyboard.press('Space');
      await waitFor((n) => !n.active || `${n.text}|${n.choices.length}` !== before, 1500);
    }
  };

  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());

  for (const [id, plan] of Object.entries(PLANS)) {
    await page.evaluate(() => localStorage.removeItem('yui-no-yakusoku:save:1'));
    await reloadTo('new');
    const outcome = await decide(plan);
    // 段取りが決まった → 作業の日を迎える → 朝の様子 → 見渡し
    await waitFor((s) => s.mode === 'notice');
    await page.click('.notice-layer .menu-item[data-id="ok"]');
    await skipScenes();
    if (id === 'solo-full') {
      // 一日を終える前に記録 → 再読み込み：屋根葺きの日の村から再開し、まだ結果画面は出ない
      await page.evaluate(() => window.__yui.saveGame());
      await reloadTo('continue');
      const b = await waitFor((s) => s.mode === 'explore', 6000);
      check(`[復元] ${id}：一日を終える前の記録からは、屋根葺きの日の村に戻る（結果画面は出ない）`, b.mode === 'explore' && b.chapter === 'roofDay' && !b.ended, JSON.stringify(b));
    }
    await endDayWithSae();
    const r1 = await waitFor((s) => s.mode === 'result', 8000);
    check(`[復元] ${id}：一日を終えると結果画面が出る`, outcome === id && r1.mode === 'result', JSON.stringify(r1));
    // 結果画面の表示中に再読み込み → つづきから
    await reloadTo('continue');
    const r2 = await waitFor((s) => s.mode === 'result', 8000);
    check(`[復元] ${id}：結果画面で再読み込みして「つづきから」を選ぶと、結果画面が戻る`, r2.mode === 'result' && r2.chapter === 'roofDay' && r2.ended, JSON.stringify(r2));
    // 結果画面を閉じる → 三年後 → 第3幕
    await page.keyboard.press('Enter');
    await waitFor((s) => s.mode === 'transition', 6000);
    const r3 = await skipScenes();
    await wait(800);
    const r4 = await st();
    check(`[復元] ${id}：再開した結果画面から第3幕へ進める（結果画面は二重に出ない）`, r3.mode === 'explore' && r4.mode === 'explore' && r4.chapter === 'ch3', JSON.stringify({ r3, r4 }));
    if (id === 'solo-full') {
      // 第3幕に入った直後に再読み込み：第3幕の村から再開し、結果画面も三年後の画面も出ない
      await reloadTo('continue');
      const c = await waitFor((s) => s.mode === 'explore', 6000);
      await wait(800);
      const c2 = await st();
      check(`[復元] ${id}：第3幕に入った直後の記録からは、第3幕の村に戻る（結果画面・三年後の画面は出ない）`, c.mode === 'explore' && c2.mode === 'explore' && c2.chapter === 'ch3', JSON.stringify(c2));
    }
  }

  // 「一日を終える」を選ばずに会話を閉じた場合は、結果画面は出ない（進行は従来どおり）
  await page.evaluate(() => localStorage.removeItem('yui-no-yakusoku:save:1'));
  await reloadTo('new');
  await decide(PLANS['prep-full']);
  await waitFor((s) => s.mode === 'notice');
  await page.click('.notice-layer .menu-item[data-id="ok"]');
  await skipScenes();
  await endDayWithSae('もう少し見て回る');
  await wait(600);
  const n1 = await st();
  check('[復元] 「もう少し見て回る」を選ぶと、結果画面は出ず、屋根葺きの日が続く', n1.mode === 'explore' && n1.chapter === 'roofDay' && !n1.ended, JSON.stringify(n1));

  // 指摘 6：屋根葺きの日の作業の場を、作る・描く・片付けるを繰り返しても GPU のテクスチャが増え続けない
  const tex = await page.evaluate(async () => {
    const g = window.__yui;
    const stage = g.roofDay.current;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const counts = [];
    for (let i = 0; i < 8; i++) {
      g.roofDay.show(null);
      await frame();
      g.roofDay.show(stage);
      await frame();
      counts.push(g.renderer.info.memory.textures);
    }
    return counts;
  });
  check('[資源] 作業の場を 8 回作り直して描いても、GPU のテクスチャ数が増え続けない（作業員の骨を片付ける）', tex.length === 8 && tex[7] <= tex[1], JSON.stringify(tex));

  // 指摘 2：通知が 3 件以上・表示中に追加・表示待ちの間に画面を開く、のどれでも、一度ずつすべて出る
  await page.evaluate(() => {
    const seen = [];
    window.__seenToasts = seen;
    new MutationObserver((ms) => {
      // このテストで出す通知（ラベル「確認」）だけを数える
      for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast') && n.querySelector('.toast-label')?.textContent === '確認') seen.push(n.querySelector('.toast-text')?.textContent);
    }).observe(document.querySelector('.toasts'), { childList: true });
    const g = window.__yui;
    g.toasts.clear(); // 前の手順の通知を片付けて、この確認だけを数える
    for (const t of ['通知1', '通知2', '通知3', '通知4']) g.notify({ label: '確認', text: t });
  });
  await wait(1500);
  await page.keyboard.press('Tab'); // 表示待ちが残っている間に手帳を開く
  await wait(5000);
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.__yui.notify({ label: '確認', text: '通知5' })); // 表示中に追加
  for (let i = 0; i < 60 && (await page.evaluate(() => window.__seenToasts.length)) < 5; i++) await wait(300);
  const seen = await page.evaluate(() => window.__seenToasts);
  const toastDebug = await page.evaluate(() => ({ mode: window.__yui.mode, deferring: window.__yui.notices.active, state: window.__yui.toasts.state }));
  check('[通知] 4 件を続けて出し、途中で画面を開いても、5 件目を足しても、すべて一度ずつ順に出る',
    JSON.stringify(seen) === JSON.stringify(['通知1', '通知2', '通知3', '通知4', '通知5']), JSON.stringify({ seen, toastDebug }));

  const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) || /^\[warn/.test(l));
  check('[復元] コンソールにエラー・警告がない', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('[復元] 例外なく最後まで進む', false, String(e?.stack ?? e));
} finally {
  finishing = true;
  console.log(`\n合計：${tally()}。${clock.describe()}`);
  await browser.close();
  await server.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
