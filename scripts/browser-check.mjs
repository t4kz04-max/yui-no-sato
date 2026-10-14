/**
 * ブラウザでの動作確認。Vite 開発サーバーを起動し、ヘッドレス Chrome で確認する。
 * - Phase 0：起動・移動・衝突・カメラ・ズーム・リサイズ・コンソールエラー
 * - Phase 1（[P1]）：案内表示、会話の開始・送り・選択・終了、会話中の操作制御、調査、状態による選択肢の変化
 * - Phase 2（[P2]）：手帳、結帳、ポーズ、会話の中断、記録（保存・続きから・壊れた記録・やり直し）
 * - Phase 4（[P4]）：宗平・ミネを含む作業台（項目の出し分け）、相談と見直し、屋根葺き当日、三年後、第3幕（Q1〜Q3）、エンディング、史実と創作の解説、記録の復元、各画面の大きさ（1280x720・1024x640）
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
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  results.push(line);
  // 途中で止まったときに、どこまで進んだか分かるように逐次出す
  if (process.env.VERBOSE) console.log(line);
};
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

// ───────── Phase 1：探索・インタラクション ─────────
const ui = () =>
  page.evaluate(() => {
    const g = window.__yui;
    const q = (s) => document.querySelector(s);
    const layer = q('.dialogue-layer');
    const prompt = q('.interaction-prompt');
    const name = q('.dialogue-name');
    return {
      objective: q('.hud-objective-text')?.textContent ?? '',
      promptVisible: !!prompt && !prompt.hidden,
      promptText: prompt?.textContent ?? '',
      dialogueVisible: !!layer && !layer.hidden,
      speaker: name && !name.hidden && !name.classList.contains('is-subject') ? name.textContent : null,
      subject: name && !name.hidden && name.classList.contains('is-subject') ? name.textContent : null,
      text: q('.dialogue-text')?.textContent ?? '',
      choices: [...document.querySelectorAll('.dialogue-choice')].map((b) => ({ text: b.textContent, selected: b.classList.contains('is-selected') })),
      active: g.interaction.isActive,
      target: g.interaction.target?.id ?? null,
      flags: g.story.flagList(),
      learned: g.story.allLearned().map((l) => `${l.topic}/${l.stage}`),
      inputEnabled: g.input.enabled,
      node: g.interaction.view?.nodeId ?? null,
    };
  });
const place = (x, z, heading) =>
  page.evaluate((x, z, heading) => {
    const p = window.__yui.player; p.x = x; p.z = z; p.heading = heading; p.velocityX = 0; p.velocityZ = 0;
  }, x, z, heading);
const waitFor = async (cond, timeoutMs = 8000) => {
  const t0 = Date.now();
  let u = await ui();
  while (!cond(u) && Date.now() - t0 < timeoutMs) { await wait(100); u = await ui(); }
  return u;
};
/** キーを押して、状態が変わるまで待つ（低 FPS でも確実に1回ずつ処理させる）。 */
const press = async (key, cond = () => true, timeoutMs = 4000) => {
  await page.keyboard.press(key);
  return waitFor(cond, timeoutMs);
};
/** 会話が終わるまで送る（選択肢が出たら pick で選ぶ）。 */
const finishDialogue = async (pick = () => 'Digit1') => {
  for (let i = 0; i < 40; i++) {
    const u = await ui();
    if (!u.active) return u;
    const before = `${u.text}|${u.choices.length}`;
    const key = u.choices.length > 0 ? pick(u) : 'KeyE';
    await press(key, (n) => !n.active || `${n.text}|${n.choices.length}` !== before);
  }
  return ui();
};

const u0 = await ui();
check('[P1] 右上に目的が表示される', u0.objective === '広場にいるトキに話しかける', u0.objective);

// トキの手前（南側）に立ち、北（トキの方）を向く
await place(-3, 20.4, Math.PI);
const u1 = await waitFor((u) => u.promptVisible);
check('[P1] 住民に近づくと「E 話す」の案内が出る', u1.promptVisible && /話す/.test(u1.promptText) && /トキ/.test(u1.promptText), u1.promptText);
await page.screenshot({ path: `${OUT}/shot-10-prompt.png` });

// 範囲外では案内が出ない
await place(-3, 26, Math.PI);
const uFar = await waitFor((u) => !u.promptVisible);
check('[P1] 離れると案内が消える', !uFar.promptVisible && uFar.target === null);

await place(-3, 20.4, Math.PI);
await waitFor((u) => u.target === 'toki');
const u2 = await press('KeyE', (u) => u.dialogueVisible);
check('[P1] E で会話が始まり、話し手の名前と台詞が出る', u2.active && u2.dialogueVisible && u2.speaker === 'トキ', `${u2.speaker}：${u2.text}`);
check('[P1] 会話中は案内表示を消し、移動入力を止める', !u2.promptVisible && u2.inputEnabled === false);

// 会話中の操作制御：移動キー・ドラッグ・ホイールが効かない
await wait(1500); // 会話用のカメラ構図へ移るのを待つ
const orbitTargets = () => page.evaluate(() => { const o = window.__yui.cameraRig.orbit; return { yaw: o.targetYaw, dist: o.targetDistance, pitch: o.targetPitch }; });
const camBefore = await orbitTargets();
const posBefore = await state();
await page.keyboard.down('KeyD');
await page.keyboard.down('ShiftLeft');
await wait(1200);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyD');
await page.mouse.move(400, 300);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(400 + i * 25, 300);
await page.mouse.up();
for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: 300 }); await wait(30); }
await wait(500);
const posAfter = await state();
const camAfter = await orbitTargets();
const moved = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z);
check('[P1] 会話中は移動キーで動かない', moved < 0.05, `移動量 ${moved.toFixed(3)}`);
check('[P1] 会話中はドラッグ・ホイールでカメラが動かない', JSON.stringify(camBefore) === JSON.stringify(camAfter), `${JSON.stringify(camBefore)} → ${JSON.stringify(camAfter)}`);
await page.screenshot({ path: `${OUT}/shot-11-dialogue.png` });

// 選択肢が出るまで送る（クリックでの送り・文字送り中の全文表示を含む）
let u3 = await ui();
for (let i = 0; i < 10 && u3.choices.length === 0; i++) {
  const before = u3.text;
  await page.mouse.click(640, 200);
  u3 = await waitFor((u) => u.text !== before || u.choices.length > 0, 3000);
}
check('[P1] クリックで送ると選択肢が出る', u3.active && u3.choices.length === 2, u3.choices.map((c) => c.text).join(' / '));
const u4 = await press('ArrowDown', (u) => u.choices[1]?.selected === true);
check('[P1] ↓キーで選択中の選択肢が移る', u4.choices[1]?.selected === true && u4.choices[0]?.selected === false);
await page.screenshot({ path: `${OUT}/shot-12-choices.png` });
// 「まず何をすればいい？」を数字キーで選ぶ
const u5 = await press('Digit1', (u) => u.choices.length === 0);
check('[P1] 数字キーで選択肢を選ぶと会話が進む', u5.active && u5.node === 'whatToDo', `${u5.node}：${u5.text}`);
const u6 = await finishDialogue();
check('[P1] 会話を終えると探索に戻り、会話済みが記録される', !u6.active && !u6.dialogueVisible && u6.inputEnabled && u6.flags.includes('talked:toki'), u6.flags.join(','));
check('[P1] 進行に応じて目的が更新される', u6.objective === 'サエ家を訪ねる', u6.objective);
// 会話終了の E で、すぐに次の会話が始まらない
await wait(600);
check('[P1] 会話を終えた直後に同じ相手との会話が再開しない', !(await ui()).active);

// 探索に戻ったら動ける
const pr0 = await state();
const pr1 = await holdUntil(['KeyS'], (s) => Math.hypot(s.x - pr0.x, s.z - pr0.z) > 1, 8000);
check('[P1] 会話の後は再び移動できる', Math.hypot(pr1.x - pr0.x, pr1.z - pr0.z) > 1);

// 調査：はさ掛け（伊助の畑）
await place(38, 10.4, Math.PI);
const u7 = await waitFor((u) => u.target === 'hasaRack' && u.promptVisible);
check('[P1] 調べられる物に近づくと「E 調べる」の案内が出る', u7.promptVisible && /調べる/.test(u7.promptText) && /はさ掛け/.test(u7.promptText), u7.promptText);
const u8 = await press('KeyE', (u) => u.dialogueVisible);
check('[P1] 調査は地の文で表示され、調べている物の名前が出る', u8.active && u8.speaker === null && u8.subject === 'はさ掛け' && u8.text.length > 0, `${u8.subject}：${u8.text}`);
await page.screenshot({ path: `${OUT}/shot-13-inspect.png` });
const u9 = await finishDialogue();
check('[P1] 調査を終えると調査済みが記録される', !u9.active && u9.flags.includes('inspected:hasaRack'));
const u9b = await waitFor((u) => u.promptVisible);
check('[P1] 調査済みの対象には「済」が付く', /済/.test(u9b.promptText), u9b.promptText);

// 調べた情報で、伊助の選択肢が増える
await place(33.5, 8.1, Math.PI);
await waitFor((u) => u.target === 'isuke');
await press('KeyE', (u) => u.dialogueVisible);
let u10 = await ui();
for (let i = 0; i < 10 && u10.choices.length === 0; i++) {
  const before = u10.text;
  u10 = await press('KeyE', (u) => u.text !== before || u.choices.length > 0, 3000);
}
const clueIndex = u10.choices.findIndex((c) => /はさ掛け/.test(c.text));
check('[P1] 調べた情報によって会話の選択肢が増える', clueIndex >= 0, u10.choices.map((c) => c.text).join(' / '));
await page.screenshot({ path: `${OUT}/shot-14-new-choice.png` });
// マウスで選ぶ
const buttons = await page.$$('.dialogue-choice');
if (clueIndex >= 0 && buttons[clueIndex]) await buttons[clueIndex].click();
await waitFor((u) => u.choices.length === 0);
const u11 = await finishDialogue();
check('[P1] クリックで選択肢を選び、知った事情が状態に残る', !u11.active && u11.learned.includes('isuke.availability/harvest'), u11.learned.join(','));
await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.targetYaw = Math.PI; o.targetPitch = 0.42; o.targetDistance = 10; });

// ───────── Phase 2：手帳・結帳・ポーズ・中断・記録 ─────────
const g2 = () =>
  page.evaluate(() => {
    const g = window.__yui;
    const q = (s) => document.querySelector(s);
    const vis = (s) => { const e = q(s); return !!e && !e.hidden; };
    return {
      mode: g.mode,
      active: g.interaction.isActive,
      flags: g.story.flagList(),
      learned: g.story.allLearned().map((l) => `${l.topic}/${l.stage}`),
      met: ['toki', 'sae', 'isuke', 'sohei', 'mine'].filter((n) => g.story.hasMet(n)),
      notebook: vis('.notebook-layer'),
      notebookText: q('.notebook-body')?.textContent ?? '',
      activeTab: q('.notebook-tab.is-active')?.dataset.tab ?? null,
      ledger: vis('.ledger-layer'),
      ledgerText: q('.ledger-body')?.textContent ?? '',
      ledgerNote: q('.ledger-note')?.textContent ?? '',
      pause: vis('.pause-layer'),
      pauseStatus: q('.pause-layer .menu-status')?.textContent ?? '',
      notice: vis('.notice-layer'),
      noticeTitle: q('.notice-layer .menu-title')?.textContent ?? '',
      badge: vis('.hud-notebook-badge'),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
      objective: q('.hud-objective-text')?.textContent ?? '',
      player: { x: g.player.x, z: g.player.z },
    };
  });
const waitFor2 = async (cond, timeoutMs = 8000) => {
  const t0 = Date.now();
  let s = await g2();
  while (!cond(s) && Date.now() - t0 < timeoutMs) { await wait(100); s = await g2(); }
  return s;
};
const press2 = async (key, cond, timeoutMs = 4000) => { await page.keyboard.press(key); return waitFor2(cond, timeoutMs); };

// 情報を得ると通知と手帳の「新しい記録」表示が出る（Phase 1 の確認で伊助の事情を知った直後）
const t0 = await g2();
check('[P2] 情報を得ると「手帳に新しい記録」が表示される', t0.badge, t0.toasts.join(' / '));

// 手帳（Tab）
const n1 = await press2('Tab', (s) => s.notebook);
check('[P2] Tab で手帳が開く', n1.mode === 'notebook' && n1.notebook);
// 区分の切り替え：毎回表示が変わる順に押す（低 FPS では、同じフレームに2つのキーが入ると後の方が勝つため）
const n3 = await press2('Digit1', (s) => s.activeTab === 'people');
check('[P2] 「人物」に会った住民と現在の意向が載る', n3.activeTab === 'people' && /伊助/.test(n3.notebookText) && /断っている/.test(n3.notebookText) && /トキ/.test(n3.notebookText) && !/ミネ/.test(n3.notebookText), n3.notebookText.slice(0, 120));
const n2 = await press2('Digit2', (s) => s.activeTab === 'known');
check('[P2] 「分かったこと」に伊助の事情が載り、前の記述が「これまでの記録」に残る',
  n2.activeTab === 'known' && /刈り入れと重なる/.test(n2.notebookText) && /これまでの記録（1）/.test(n2.notebookText), n2.notebookText.slice(0, 120));
const n4 = await press2('ArrowRight', (s) => s.activeTab === 'unconfirmed');
check('[P2] ←→ で区分を切り替えられる', n4.activeTab === 'unconfirmed');
await press2('ArrowLeft', (s) => s.activeTab === 'known');
await page.screenshot({ path: `${OUT}/shot-20-notebook.png` });
const nbPos0 = await state();
await page.keyboard.down('KeyW');
await wait(800);
await page.keyboard.up('KeyW');
const nbPos1 = await state();
check('[P2] 手帳を開いている間は歩かない', Math.hypot(nbPos1.x - nbPos0.x, nbPos1.z - nbPos0.z) < 0.05);
const n5 = await press2('Tab', (s) => !s.notebook);
check('[P2] Tab で手帳を閉じると探索に戻り、「新しい記録」の表示が消える', n5.mode === 'explore' && !n5.notebook && !n5.badge);

// ポーズ（Esc）
const p1 = await press2('Escape', (s) => s.pause);
check('[P2] 探索中の Esc でポーズ画面が開く', p1.mode === 'pause' && p1.pause);
await page.screenshot({ path: `${OUT}/shot-21-pause.png` });
const p2 = await press2('Escape', (s) => !s.pause);
check('[P2] もう一度 Esc で再開する', p2.mode === 'explore' && !p2.pause);

// 会話の中断（Esc）
await place(3.4, 12.4, Math.PI);
await waitFor((u) => u.target === 'sae');
await press('KeyE', (u) => u.dialogueVisible);
await wait(400);
const c1 = await press2('Escape', (s) => !s.active);
await wait(500);
const c1b = await g2();
check('[P2] 会話中の Esc で会話を中断し、探索に戻る（ポーズは開かない）', c1b.mode === 'explore' && !c1b.active && !c1b.pause, c1b.mode);
check('[P2] 中断しても会ったことと得た情報は残り、「最後まで話した」にはならない',
  c1.met.includes('sae') && c1.learned.includes('sae.schedule/needsHelp') && !c1.flags.includes('talked:sae'), c1.learned.join(','));

// 結帳
await place(5.8, 12.0, Math.PI);
await waitFor((u) => u.target === 'ledger');
await press('KeyE', (u) => u.dialogueVisible);
const l0 = await finishDialogue();
const l1 = await waitFor2((s) => s.ledger);
check('[P2] 結帳を調べると専用画面が開く', l1.mode === 'ledger' && l1.ledger && !l0.active);
check('[P2] 結帳に過去の協力と返しの状態が書かれている', /伊助家 → サエ家/.test(l1.ledgerText) && /返し まだ/.test(l1.ledgerText) && /返し 済/.test(l1.ledgerText));
check('[P2] 結帳では現在の意向を過去の記録と別の欄に示す', /今の意向（手帳より・この記録とは別）/.test(l1.ledgerText) && /断っている/.test(l1.ledgerText));
check('[P2] 結帳が創作の記録であることを画面に明記している', /ゲームのために創作した記録/.test(l1.ledgerNote));
await page.screenshot({ path: `${OUT}/shot-22-ledger.png` });
const l2 = await press2('Escape', (s) => !s.ledger);
check('[P2] Esc で結帳を閉じて探索に戻る', l2.mode === 'explore');

// 結帳を読んだ後は、伊助に過去の協力について聞ける
await place(33.5, 8.1, Math.PI);
await waitFor((u) => u.target === 'isuke');
await press('KeyE', (u) => u.dialogueVisible);
let i1 = await ui();
for (let i = 0; i < 10 && i1.choices.length === 0; i++) {
  const before = i1.text;
  i1 = await press('KeyE', (u) => u.text !== before || u.choices.length > 0, 3000);
}
check('[P2] 結帳を読んだ後、伊助に新しい選択肢が出る', i1.choices.some((c) => /十二年前/.test(c.text)), i1.choices.map((c) => c.text).join(' / '));
await finishDialogue((u) => `Digit${Math.max(0, u.choices.findIndex((c) => /十二年前/.test(c.text))) + 1}`);
const i2 = await g2();
check('[P2] 過去の協力について聞くと手帳が更新されるが、現在の意向は変わらない',
  i2.learned.includes('isuke.pastHelp/isukeView') && /断っている/.test(await page.evaluate(() => window.__yui.story.consentStatus('isuke', 'roofDay') === 'declined' ? '断っている' : '')));

// 記録（セーブ）→ 再読み込み → 続きから
await page.keyboard.press('Escape');
await waitFor2((s) => s.pause);
await page.click('.pause-layer .menu-item[data-id="save"]');
const sv1 = await waitFor2((s) => /記録しました/.test(s.pauseStatus));
check('[P2] ポーズ画面から記録できる', /記録しました/.test(sv1.pauseStatus), sv1.pauseStatus);
await press2('Escape', (s) => !s.pause);
const beforeReload = await g2();
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
const r1 = await waitFor2((s) => s.notice);
check('[P2] 再読み込みすると「前回の記録があります」が出る', r1.notice && /前回の記録/.test(r1.noticeTitle) && r1.mode === 'notice', r1.noticeTitle);
await page.screenshot({ path: `${OUT}/shot-23-continue.png` });
const r1b = await press2('Escape', () => false, 800);
check('[P2] お知らせは Esc で誤って閉じない', r1b.notice && r1b.mode === 'notice');
await page.click('.notice-layer .menu-item[data-id="continue"]');
const r2 = await waitFor2((s) => !s.notice);
check('[P2] 「続きから」で記録した状態に戻る',
  r2.mode === 'explore' && JSON.stringify(r2.learned) === JSON.stringify(beforeReload.learned) && JSON.stringify(r2.met) === JSON.stringify(beforeReload.met) &&
  Math.hypot(r2.player.x - beforeReload.player.x, r2.player.z - beforeReload.player.z) < 0.5,
  `情報 ${r2.learned.length} 件 / 位置 (${r2.player.x.toFixed(1)}, ${r2.player.z.toFixed(1)})`);
check('[P2] 読み込んだ状態から目的表示が復元される', r2.objective === beforeReload.objective, r2.objective);

// 壊れた記録
await page.evaluate(() => localStorage.setItem('yui-no-yakusoku:save:1', '{"format":"yui-no-yakusoku-save","version":1,"story":'));
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
const b1 = await waitFor2((s) => s.notice);
check('[P2] 壊れた記録は読み込まずに知らせる', /読み込めませんでした/.test(b1.noticeTitle), b1.noticeTitle);
await page.click('.notice-layer .menu-item[data-id="ok"]');
const b2 = await waitFor2((s) => !s.notice);
const kept = await page.evaluate(() => [localStorage.getItem('yui-no-yakusoku:save:1'), localStorage.getItem('yui-no-yakusoku:save:1:corrupt')]);
check('[P2] 壊れた記録は別名で残し、最初から遊べる', b2.mode === 'explore' && b2.learned.length === 0 && kept[0] === null && typeof kept[1] === 'string');
const b3 = await holdUntil(['KeyW'], (s) => s.z < 29, 8000);
check('[P2] 壊れた記録の後も操作できる', b3.z < 29, `z=${b3.z.toFixed(2)}`);

// 最初からやり直す
await page.evaluate(() => { window.__yui.story.learn('sae.roof', 'worn'); });
await page.keyboard.press('Escape');
await waitFor2((s) => s.pause);
await page.click('.pause-layer .menu-item[data-id="new"]');
await waitFor2((s) => s.notice);
await page.click('.notice-layer .menu-item[data-id="yes"]');
const nw = await waitFor2((s) => !s.notice);
check('[P2] 「最初からやり直す」で状態が初期化される', nw.mode === 'explore' && nw.learned.length === 0 && nw.objective === '広場にいるトキに話しかける');

// ───────── Phase 4：宗平・ミネを含む計画、屋根葺き当日、第3幕、エンディング ─────────
// 情報集めの細部は Phase 1〜3 の確認と単体テストで確かめているので、ここでは状態を直接用意し、
// 作業台・相談・見直し・決定・章の移り変わり・エンディングを実際の操作で確かめる。
await page.evaluate(() => {
  const s = window.__yui.story;
  for (const n of ['sae', 'isuke', 'sohei', 'mine']) s.markMet(n);
  for (const f of ['talked:sae', 'talked:isuke', 'talked:sohei', 'talked:mine']) s.set(f);
  const learn = [
    ['sae.schedule', 'needsHelp'], ['sae.kaya', 'short'], ['sae.roof', 'worn'],
    ['isuke.availability', 'declined'], ['isuke.field', 'harvesting'], ['isuke.availability', 'harvest'],
    ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'],
    ['sohei.schedule', 'hasConflict'], ['sohei.schedule', 'kayaCutting'],
    ['mine.kaya', 'reluctant'], ['mine.kaya', 'returnTerms'],
  ];
  for (const [t, st] of learn) s.learn(t, st);
  s.setConsent('mine', 'showRecords', 'agreed');
  s.learn('mine.kaya', 'whyRecord');
});
const p4 = () =>
  page.evaluate(() => {
    const g = window.__yui;
    const q = (s) => document.querySelector(s);
    const vis = (s) => { const e = q(s); return !!e && !e.hidden; };
    const roof = (id) => g.world.roofs.get(id)?.materials[1]?.color.getHex() ?? null;
    return {
      mode: g.mode,
      chapter: g.story.chapter,
      phase: g.story.planPhase(),
      outcome: g.story.outcome() ?? null,
      draft: g.story.planDraft(),
      plan: vis('.plan-layer'),
      items: [...document.querySelectorAll('.plan-item')].map((i) => i.dataset.item),
      options: Object.fromEntries([...document.querySelectorAll('.plan-item')].map((i) => [i.dataset.item, [...i.querySelectorAll('.plan-option')].map((b) => b.dataset.option)])),
      responses: [...document.querySelectorAll('.plan-response')].map((r) => `${r.dataset.npc}:${r.querySelector('.plan-response-chip')?.textContent}`),
      decideDisabled: q('.plan-decide')?.disabled ?? null,
      result: vis('.result-layer'),
      resultTitle: q('.result-layer .result-title')?.textContent ?? '',
      ending: vis('.ending-layer'),
      endingText: q('.ending-layer .result-body')?.textContent ?? '',
      explain: vis('.explain-layer'),
      explainText: q('.explain-layer .result-body')?.textContent ?? '',
      notice: vis('.notice-layer'),
      noticeTitle: q('.notice-layer .menu-title')?.textContent ?? '',
      objective: q('.hud-objective-text')?.textContent ?? '',
      villagers: g.villagers.visible,
      saeRoof: roof('sae'),
      isukeRoof: roof('isuke'),
      where: Object.fromEntries(g.interaction.interactables.filter((i) => i.kind === 'npc').map((i) => [i.id, [i.position.x, i.position.z]])),
    };
  });
const waitP4 = async (cond, timeoutMs = 8000) => {
  const t0 = Date.now();
  let s = await p4();
  while (!cond(s) && Date.now() - t0 < timeoutMs) { await wait(100); s = await p4(); }
  return s;
};
/**
 * 表示中の選択肢から、指定した文言のどれかを含むものを選ぶ（なければ最後＝切り上げる選択肢）。
 * 状態を持たない：選択肢が出た直後のキー入力は受け付けられないため、同じ画面で押し直すことがある。
 */
const pickText = (...texts) => (u) => {
  for (const want of texts) {
    const idx = u.choices.findIndex((c) => c.text.includes(want));
    if (idx >= 0) return `Digit${idx + 1}`;
  }
  return `Digit${u.choices.length}`;
};
const talkTo = async (id, x, z, heading, pick) => {
  await place(x, z, heading);
  await waitFor((u) => u.target === id);
  await press('KeyE', (u) => u.dialogueVisible);
  return finishDialogue(pick);
};
const SPOT = {
  sae: [3.4, 12.4, Math.PI],
  isuke: [33.5, 8.1, Math.PI],
  sohei: [-2.5, -21.6, Math.PI],
  mine: [-15.2, -8.4, Math.PI],
};
const consult = (id) => talkTo(id, ...SPOT[id], pickText('作業台でまとめた案', 'この'));
const openPlan = async () => {
  await place(4.5, -18.6, Math.PI);
  await waitFor((u) => u.target === 'planTable');
  await press('KeyE', (u) => u.dialogueVisible);
  await finishDialogue();
  return waitP4((s) => s.plan);
};
const clickOption = async (item, option) => {
  await page.click(`.plan-item[data-item="${item}"] .plan-option[data-option="${option}"]`);
  return waitP4((s) => s.draft?.[item] === option);
};
const closePlan = async () => { await page.keyboard.press('Escape'); await waitP4((s) => !s.plan); };
/** パネルが画面内に収まり、本文が指定の大きさ以上か。中身が多いときは中だけがスクロールできるか。 */
const layout = (panelSel, textSel, bodySel) =>
  page.evaluate((p, t, b) => {
    const e = document.querySelector(p);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const te = document.querySelector(t);
    const body = b ? document.querySelector(b) : null;
    const scrollOk = !body || body.scrollHeight <= body.clientHeight + 2 || ['auto', 'scroll'].includes(getComputedStyle(body).overflowY);
    return {
      inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.width > 100,
      font: te ? parseFloat(getComputedStyle(te).fontSize) : 0,
      scrollOk,
      size: `${Math.round(r.width)}x${Math.round(r.height)} / ${innerWidth}x${innerHeight}`,
    };
  }, panelSel, textSel, bodySel ?? null);
const fits = (l, minFont) => !!l && l.inView && l.font >= minFont && l.scrollOk;
const roofBefore = (await p4()).saeRoof;

// ── 作業台：項目は案に応じて出し分ける ──
const q4a1 = await openPlan();
check('[P4] 作業台に、茅とミネへの返し方の項目が出る（宗平の別件は延ばすときだけ）',
  JSON.stringify(q4a1.items) === JSON.stringify(['date', 'isuke', 'offer', 'kaya', 'kayaReturn']), JSON.stringify(q4a1.items));
check('[P4] 知っている情報に応じて、茅（手持ち）・返し方（茅で返す・記す）が選べる',
  JSON.stringify(q4a1.options.kaya) === JSON.stringify(['mine', 'own']) && JSON.stringify(q4a1.options.kayaReturn) === JSON.stringify(['labor', 'nextYear', 'nextYearRecorded']),
  JSON.stringify(q4a1.options));
check('[P4] 最初の案は、サエ・宗平・伊助・ミネの4人に相談が要る', q4a1.responses.length === 4 && q4a1.responses.every((r) => /まだ相談していない/.test(r)), q4a1.responses.join(' / '));
const q4a2 = await clickOption('date', 'afterHarvest');
check('[P4] 日取りを延ばすと「宗平の別件」の項目が出る', q4a2.items.includes('soheiCover') && q4a2.options.soheiCover?.includes('mineCovers'), JSON.stringify(q4a2.items));
await clickOption('date', 'keep');
const q4a3 = await clickOption('kaya', 'own');
check('[P4] 手持ちの茅にすると返し方の項目が消え、ミネへの相談も不要になる', !q4a3.items.includes('kayaReturn') && !q4a3.responses.some((r) => r.startsWith('mine:')), `${JSON.stringify(q4a3.items)} / ${q4a3.responses.join(' / ')}`);
await clickOption('kaya', 'mine');
await page.screenshot({ path: `${OUT}/shot-50-plan-p4.png` });
await closePlan();

// ── ミネに相談 → 条件付き（要るのは茅）→ 見直し ──
await consult('mine');
const q4a4 = await p4();
check('[P4] ミネに「手伝いで返す」案を相談すると条件付きで、見直しを促される', q4a4.phase === 'revise' && /見直す/.test(q4a4.objective), `${q4a4.phase} / ${q4a4.objective}`);
await openPlan();
await clickOption('isuke', 'dayBefore');
await clickOption('offer', 'harvestHelp');
const q4a5 = await clickOption('kayaReturn', 'nextYearRecorded');
check('[P4] 案を変えると、関係する4人にもう一度相談が要る', q4a5.phase === 'pending' && q4a5.responses.length === 4, q4a5.responses.join(' / '));
await closePlan();
for (const id of ['isuke', 'sae', 'sohei', 'mine']) await consult(id);
const q4a6 = await openPlan();
check('[P4] 4人が承諾すると決められ、承諾を得た案に並ぶ', q4a6.phase === 'ready' && q4a6.decideDisabled === false && q4a6.responses.every((r) => /承諾/.test(r)), q4a6.responses.join(' / '));

// ── 決定 → 屋根葺き当日 ──
await page.click('.plan-decide');
await waitP4((s) => s.notice);
await page.click('.notice-layer .menu-item[data-id="yes"]');
const q4d1 = await waitP4((s) => s.notice && /屋根葺きの日/.test(s.noticeTitle));
check('[P4] 決めると「屋根葺きの日」に移る', q4d1.chapter === 'roofDay' && /屋根葺きの日/.test(q4d1.noticeTitle), q4d1.noticeTitle);
await page.click('.notice-layer .menu-item[data-id="ok"]');
const q4d2 = await waitP4((s) => !s.notice);
check('[P4] 当日は村の人たちが手伝いに来て、宗平とミネがサエ家の前にいる',
  q4d2.villagers && Math.abs(q4d2.where.sohei[0] + 4.8) < 0.01 && Math.abs(q4d2.where.mine[0] - 8.2) < 0.01, JSON.stringify(q4d2.where));
await page.evaluate(() => { const g = window.__yui; g.player.x = 0; g.player.z = 22; const o = g.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; o.pitch = o.targetPitch = 0.35; o.distance = o.targetDistance = 16; });
await wait(1200);
await page.screenshot({ path: `${OUT}/shot-51-roofday.png` });
await talkTo('sohei', -4.8, 12.4, Math.PI);
const q4day = await page.evaluate(() => window.__yui.story.flagList());
check('[P4] 当日の住民と話せる（宗平：段取り）', q4day.includes('talked:sohei'));
await talkTo('sae', 3.4, 12.4, Math.PI, pickText('一日を終える'));
const q4d3 = await waitP4((s) => s.result);
check('[P4] サエと話して一日を終えると、結果画面が出る（前日の準備を分け合って）', q4d3.result && /前日の準備を分け合って/.test(q4d3.resultTitle), q4d3.resultTitle);
const q4rl = await layout('.result-layer .result', '.result-layer .result-block li', '.result-layer .result-body');
check('[P4] 結果画面は画面に収まり、本文は16px以上', fits(q4rl, 16), JSON.stringify(q4rl));
await page.screenshot({ path: `${OUT}/shot-52-result-p4.png` });
await page.keyboard.press('Enter');
const q4d4 = await waitP4((s) => s.notice && /三年後/.test(s.noticeTitle));
check('[P4] 結果の後、「それから三年後の秋」に移り、三年のあいだのことが示される', /三年後/.test(q4d4.noticeTitle), q4d4.noticeTitle);
await page.screenshot({ path: `${OUT}/shot-53-three-years.png` });
await page.click('.notice-layer .menu-item[data-id="ok"]');
const q4c1 = await waitP4((s) => !s.notice && s.chapter === 'ch3');
check('[P4] 第3幕：サエ家の屋根は葺き替え後、伊助家の屋根は傷んだ見た目になる', q4c1.saeRoof !== roofBefore && q4c1.isukeRoof !== null && q4c1.isukeRoof !== q4c1.saeRoof, `${q4c1.saeRoof?.toString(16)} / ${q4c1.isukeRoof?.toString(16)}`);

// ── 第3幕 ──
await talkTo('isuke', ...SPOT.isuke);
const q4c2 = await openPlan();
check('[P4] 第3幕の作業台：伊助家の屋根葺き。サエの足のことを知らないと「下の仕事」は出ない',
  JSON.stringify(q4c2.options.saeHelp) === JSON.stringify(['roofTop', 'none']), JSON.stringify(q4c2.options));
await closePlan();
await consult('sae');
const q4c3 = await p4();
check('[P4] 記録どおり「屋根の上」を頼むと、サエは断る（記録を理由に強制できない）', q4c3.phase === 'revise', q4c3.phase);
const q4c4 = await openPlan();
check('[P4] サエの返事で足のことが分かり、「下の仕事」が選べるようになる', q4c4.options.saeHelp?.includes('ground'), JSON.stringify(q4c4.options.saeHelp));
await clickOption('saeHelp', 'ground');
await closePlan();
await consult('sae');
await consult('isuke');
await openPlan();
await page.click('.plan-decide');
await waitP4((s) => s.notice);
await page.click('.notice-layer .menu-item[data-id="yes"]');
const q4e1 = await waitP4((s) => s.ending);
check('[P4] 役割を相談し直して決めると、エンディング E1「つながる約束」', q4e1.ending && /E1/.test(q4e1.endingText) && /つながる約束/.test(q4e1.endingText) && q4e1.chapter === 'end', q4e1.endingText.slice(0, 80));
check('[P4] エンディングで、第1幕・第3幕の選択と結帳に残ったことを振り返れる', /第1幕/.test(q4e1.endingText) && /第3幕/.test(q4e1.endingText) && /返し 済/.test(q4e1.endingText));
const q4el = await layout('.ending-layer .result', '.ending-layer .result-block li', '.ending-layer .result-body');
check('[P4] エンディング画面は画面に収まる', fits(q4el, 16), JSON.stringify(q4el));
await page.screenshot({ path: `${OUT}/shot-54-ending.png` });
await page.click('.ending-layer .plan-pick');
const q4x1 = await waitP4((s) => s.explain);
check('[P4] エンディングから「史実と創作について」を開ける', q4x1.explain && /合力/.test(q4x1.explainText) && /ゲーム用の創作/.test(q4x1.explainText) && /出典は確認中/.test(q4x1.explainText));
await page.screenshot({ path: `${OUT}/shot-55-explain.png` });
await page.keyboard.press('Escape');
const q4x2 = await waitP4((s) => !s.explain);
check('[P4] 閉じると村に戻り、物語の終わりが目的に出る', q4x2.mode === 'explore' && /物語はここまで/.test(q4x2.objective) && q4x2.isukeRoof === q4x2.saeRoof, q4x2.objective);

// ── 記録 → 再読み込み → 続きから ──
await page.keyboard.press('Escape');
await waitFor2((s) => s.pause);
await page.click('.pause-layer .menu-item[data-id="save"]');
await waitFor2((s) => /記録しました/.test(s.pauseStatus));
await press2('Escape', (s) => !s.pause);
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
await waitFor2((s) => s.notice);
await page.click('.notice-layer .menu-item[data-id="continue"]');
const q4r4 = await waitP4((s) => !s.notice);
check('[P4] 再読み込み後も、章・両方の計画・結末・屋根の見た目が戻る', q4r4.chapter === 'end' && q4r4.outcome === 'e1' && q4r4.isukeRoof === q4r4.saeRoof, `${q4r4.chapter} / ${q4r4.outcome}`);

// ── 読みやすさ（Phase 3.5 の改善を維持） ──
for (const [w, h] of [[1280, 720], [1024, 640]]) {
  await page.setViewport({ width: w, height: h });
  await wait(800);
  const q4tag = `${w}x${h}`;
  await place(...SPOT.sae);
  await waitFor((u) => u.target === 'sae');
  await press('KeyE', (u) => u.dialogueVisible);
  await page.keyboard.press('Space');
  await wait(600);
  const q4dl = await layout('.dialogue-box', '.dialogue-text', '.dialogue-text');
  check(`[P4] ${q4tag} 会話：画面に収まり、本文は19px以上`, fits(q4dl, 19), JSON.stringify(q4dl));
  await finishDialogue();
  await press2('Tab', (s) => s.notebook);
  const q4nb = await layout('.notebook', '.notebook-item-summary', '.notebook-body');
  check(`[P4] ${q4tag} 手帳：画面に収まり、要点は18px以上`, fits(q4nb, 18), JSON.stringify(q4nb));
  await press2('Tab', (s) => !s.notebook);
  await place(5.8, 12.0, Math.PI);
  await waitFor((u) => u.target === 'ledger');
  await press('KeyE', (u) => u.dialogueVisible);
  await finishDialogue();
  const q4lg3 = await waitFor2((s) => s.ledger);
  const q4ll = await layout('.ledger', '.ledger-item-line', '.ledger-body');
  check(`[P4] ${q4tag} 結帳：画面に収まり、今年と三年後の記録が書き加わっている`, fits(q4ll, 16) && /今年の秋/.test(q4lg3.ledgerText) && /三年後の秋/.test(q4lg3.ledgerText), JSON.stringify(q4ll));
  if (w === 1280) await page.screenshot({ path: `${OUT}/shot-56-ledger-end.png` });
  await press2('Escape', (s) => !s.ledger);
  await openPlan();
  const q4pl = await layout('.plan', '.plan-option', '.plan-body');
  check(`[P4] ${q4tag} 作業台：画面に収まり、選択肢は16px以上`, fits(q4pl, 16), JSON.stringify(q4pl));
  await closePlan();
  await press2('Escape', (s) => s.pause);
  const q4pm = await layout('.pause-layer .menu-panel', '.pause-layer .menu-item');
  check(`[P4] ${q4tag} ポーズ：画面に収まり、「史実と創作について」がある`, fits(q4pm, 17) && (await page.evaluate(() => !!document.querySelector('.pause-layer .menu-item[data-id="explain"]'))), JSON.stringify(q4pm));
  await page.click('.pause-layer .menu-item[data-id="explain"]');
  await waitP4((s) => s.explain);
  const q4xl = await layout('.explain-layer .result', '.explain-layer .result-block li', '.explain-layer .result-body');
  check(`[P4] ${q4tag} 史実と創作の解説：画面に収まる`, fits(q4xl, 16), JSON.stringify(q4xl));
  await page.keyboard.press('Escape');
  await waitP4((s) => !s.explain);
}
await page.setViewport({ width: 1280, height: 720 });
await wait(600);

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
