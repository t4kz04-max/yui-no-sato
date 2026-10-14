/**
 * ブラウザでの動作確認。Vite 開発サーバーを起動し、ヘッドレス Chrome で確認する。
 * - Phase 0：起動・移動・衝突・カメラ・ズーム・リサイズ・コンソールエラー
 * - Phase 1（[P1]）：案内表示、会話の開始・送り・選択・終了、会話中の操作制御、調査、状態による選択肢の変化
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
      flags: g.story.snapshot(),
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
check('[P1] クリックで選択肢を選び、知った事情が状態に残る', !u11.active && u11.flags.includes('fact:isukeHarvest'), u11.flags.join(','));
await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.targetYaw = Math.PI; o.targetPitch = 0.42; o.targetDistance = 10; });

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
