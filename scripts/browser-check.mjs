/**
 * ブラウザでの動作確認。Vite 開発サーバーを起動し、ヘッドレス Chrome で確認する。
 * - Phase 0：起動・移動・衝突・カメラ・ズーム・リサイズ・コンソールエラー
 * - Phase 1（[P1]）：案内表示、会話の開始・送り・選択・終了、会話中の操作制御、調査、状態による選択肢の変化
 * - Phase 2（[P2]）：手帳、結帳、ポーズ、会話の中断、記録（保存・続きから・壊れた記録・やり直し）
 * - Phase 5.5（[P5.5]）：サエ家の出入り（許しの前後）、室内の移動とカメラ、結帳、室内での記録・読込、橋の欄干（実際に歩かせる）、橋の通行
 * - Phase 5（[P5]）：住民の待機の型、5 地点、すべての住民・調べられる物の操作、屋根葺きの日（計画ごとの人・役割・茅の山・足場、運ぶ人の動きと立ち止まり）、第3幕の見た目（杖・屋根）、記録の復元、描画呼び出し数
 * - Phase 6（[P6]）：タイトル画面・導入・操作の手引き、決定時の知らせと屋根葺きの日の朝・見渡し、選んだことの記録、三年後の時間経過、エンディングの振り返り、史実と創作（4 区分と出典）、音（開始・ミュート）、設定の保存、室内の壁際のカメラ、作業台の見比べ、屋根葺きの日のひと言・作業の進み具合・作業の音、設定と記録の画面の大きさ
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
// 途中で例外が起きても、それまでの結果と画面を残し、テスト用に起動したブラウザだけを閉じる
process.on('uncaughtException', async (e) => {
  console.log(results.join('\n'));
  console.log(`\nCRASH: ${e?.stack ?? e}`);
  await page.screenshot({ path: `${OUT}/crash.png` }).catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  process.exit(1);
});
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

// Phase 6：タイトル画面・時間経過の画面
const gameMode = () => page.evaluate(() => window.__yui?.mode ?? null);
const waitMode = async (m, timeoutMs = 10000) => {
  const t0 = Date.now();
  let cur = await gameMode();
  while (cur !== m && Date.now() - t0 < timeoutMs) { await wait(100); cur = await gameMode(); }
  return cur;
};
/** 時間経過の画面（行を出し切る → 閉じる）と短い演出（見渡し）を、決定キーで進める。 */
const skipScenes = async () => {
  for (let i = 0; i < 40; i++) {
    const m = await gameMode();
    if (m === 'transition' || m === 'cinematic') { await page.keyboard.press('Enter'); await wait(250); }
    else if (m !== null) return m;
    else await wait(100);
  }
  return gameMode();
};
/** タイトル画面から始める（new：はじめから／continue：つづきから）。 */
const startFromTitle = async (choice = 'new') => {
  await waitMode('title');
  await page.click(`.title-layer .title-item[data-id="${choice}"]`);
  await wait(200);
  if (choice === 'new' && (await gameMode()) === 'notice') { await page.click('.notice-layer .menu-item[data-id="yes"]'); await wait(200); }
  await skipScenes();
  return waitMode('explore');
};
const titleState = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const vis = (s) => { const e = q(s); return !!e && !e.hidden; };
    return {
      mode: window.__yui?.mode ?? null,
      title: vis('.title-layer'),
      items: [...document.querySelectorAll('.title-item')].map((b) => `${b.dataset.id}${b.disabled ? ':disabled' : ''}`),
      status: q('.title-status')?.textContent ?? '',
      controls: q('.title-controls')?.textContent ?? '',
      loading: !!q('#loading'),
      hudHidden: q('#hud')?.classList.contains('is-title') ?? false,
    };
  });

await page.goto(url, { waitUntil: 'networkidle0' });
await wait(2500);

// ── Phase 6：ローディング → タイトル画面 → 導入 → 村 ──
const t6a = await titleState();
check('[P6] 起動するとタイトル画面が出る（ローディング表示は消えている）', t6a.mode === 'title' && t6a.title && !t6a.loading, JSON.stringify(t6a));
check('[P6] 記録がないとき「つづきから」は選べず、「はじめから」「設定」「史実と創作について」がある',
  JSON.stringify(t6a.items) === JSON.stringify(['continue:disabled', 'new', 'settings', 'explain']), JSON.stringify(t6a.items));
check('[P6] タイトル画面に基本操作（WASD・Shift・ドラッグ・E・Tab・Esc）が書いてあり、探索用の表示は隠れている',
  ['W A S D', 'Shift', 'ドラッグ', 'E', 'Tab', 'Esc'].every((k) => t6a.controls.includes(k)) && t6a.hudHidden, t6a.controls);
await page.screenshot({ path: `${OUT}/shot-00-title.png` });
await page.keyboard.press('Escape');
await wait(300);
check('[P6] タイトル画面は Esc で閉じない', (await gameMode()) === 'title');
await page.click('.title-layer .title-item[data-id="new"]');
const t6b = await page.evaluate(() => ({ mode: window.__yui.mode, title: document.querySelector('.transition-title')?.textContent ?? '' }));
check('[P6] 「はじめから」で導入（時間と場面の説明）が出る', t6b.mode === 'transition' && /屋根葺きを控えた秋/.test(t6b.title), JSON.stringify(t6b));
await wait(600);
await page.screenshot({ path: `${OUT}/shot-00b-opening.png` });
await skipScenes();
const t6c = await page.evaluate(() => ({ mode: window.__yui.mode, hint: document.querySelector('.hud-hint')?.textContent ?? '', hintVisible: !document.querySelector('.hud-hint')?.hidden }));
check('[P6] 導入を進めると村に出て、最初の操作の手引き（WASD で歩く）が出る', t6c.mode === 'explore' && t6c.hintVisible && /歩く/.test(t6c.hint), JSON.stringify(t6c));

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
// （ソフトウェア描画では歩みが遅いので、決まった時間ではなく「止まって 1.5 秒動かない」まで押し続ける）
let lastZ = Infinity;
let stillSince = Date.now();
const s2 = await holdUntil(["KeyW"], (s) => {
  if (Math.abs(s.z - lastZ) > 0.01) { lastZ = s.z; stillSince = Date.now(); }
  return Date.now() - stillSince > 1500;
}, 25000);
// Phase 5 でサエ家の棟を東西に回したので、南の壁面は z=6.6
check("サエ家（中央）をすり抜けない", s2.z > 6.6 + 0.34 && s2.z < 7.2, `z=${s2.z.toFixed(3)}（壁面 z=6.6、半径 0.35）`);
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
// サエ家の躯体（Phase 5 で棟を東西に回した）：x ±8.4, z ±6, 高さ ~6.2（scale 1.2）。屋根は更に上
const insideBody = Math.abs(camInHouse.x) < 8.4 && Math.abs(camInHouse.z) < 6 && camInHouse.y < 6.2;
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

/** Phase 5.5：サエ家の入口の前に立って E（許しがあれば室内へ）。屋内になったかを返す。 */
const indoorState = () => page.evaluate(() => ({ indoor: window.__yui.world.indoor, x: window.__yui.player.x, z: window.__yui.player.z }));
const enterSaeHouse = async () => {
  await place(0, 7.4, Math.PI);
  await waitFor((u) => u.target === 'saeDoor');
  await press('KeyE', (u) => u.dialogueVisible);
  await finishDialogue();
  await wait(300);
  return indoorState();
};
/** 室内の入口の前に立って E（外へ）。 */
const leaveSaeHouse = async () => {
  await place(0, 4.4, 0);
  await waitFor((u) => u.target === 'saeDoorInside');
  await press('KeyE', (u) => u.dialogueVisible);
  await finishDialogue();
  await wait(300);
  return indoorState();
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

// 結帳（Phase 5.5：サエ家の室内。サエに頼んでから入る）
const h0 = await enterSaeHouse();
const h0text = await page.evaluate(() => window.__yui.story.flagList());
check('[P5.5] サエに頼む前は、入口で断られて家に入れない', !h0.indoor && !h0text.includes('asked:saeLedger'), JSON.stringify(h0));
await place(3.4, 12.4, Math.PI);
await waitFor((u) => u.target === 'sae');
await press('KeyE', (u) => u.dialogueVisible);
await finishDialogue((u) => {
  const i = u.choices.findIndex((c) => c.text.includes('結帳を見てもいいですか'));
  return i >= 0 ? `Digit${i + 1}` : `Digit${u.choices.length}`;
});
const h1 = await enterSaeHouse();
check('[P5.5] サエに頼むと、入口から家に入れる（室内に移る）', h1.indoor && Math.abs(h1.z - 3.4) < 0.3, JSON.stringify(h1));
// 室内を歩く：北へ 2 秒歩いても壁の中に入らず、室内に留まる
await page.keyboard.down('KeyW');
await wait(2000);
await page.keyboard.up('KeyW');
await wait(300);
const h2 = await page.evaluate(() => {
  const g = window.__yui; const c = g.camera.position;
  return { indoor: g.world.indoor, x: g.player.x, z: g.player.z, cam: [c.x, c.y, c.z], floor: g.player.y };
});
check('[P5.5] 室内を自由に歩ける（入った位置から動き、室内に留まる）', h2.indoor && h2.z < 3.0 && Math.abs(h2.x) < 8.1 && h2.z > -5.7, JSON.stringify(h2));
check('[P5.5] 室内ではカメラが壁と天井の内側に収まる', Math.abs(h2.cam[0]) < 8.1 && h2.cam[2] < 5.7 && h2.cam[2] > -5.7 && h2.cam[1] < h2.floor + 3.4, JSON.stringify(h2.cam));
await page.screenshot({ path: `${OUT}/shot-24-interior.png` });
await place(1.4, -3.9, Math.PI);
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
const h3 = await leaveSaeHouse();
check('[P5.5] 室内の入口から外に戻れる（入口の前の外に出る）', !h3.indoor && h3.z > 7 && Math.abs(h3.x) < 0.5, JSON.stringify(h3));
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
await waitMode('title');
const r1 = await titleState();
check('[P2] 再読み込みすると、タイトル画面に「前回の記録」が出て「つづきから」を選べる', r1.mode === 'title' && /前回の記録/.test(r1.status) && r1.items.includes('continue'), r1.status);
await page.screenshot({ path: `${OUT}/shot-23-continue.png` });
await page.keyboard.press('Escape');
await wait(600);
check('[P2] タイトル画面は Esc で誤って閉じない', (await gameMode()) === 'title');
await page.click('.title-layer .title-item[data-id="continue"]');
const r2 = await waitFor2((s) => s.mode === 'explore');
check('[P2] 「続きから」で記録した状態に戻る',
  r2.mode === 'explore' && JSON.stringify(r2.learned) === JSON.stringify(beforeReload.learned) && JSON.stringify(r2.met) === JSON.stringify(beforeReload.met) &&
  Math.hypot(r2.player.x - beforeReload.player.x, r2.player.z - beforeReload.player.z) < 0.5,
  `情報 ${r2.learned.length} 件 / 位置 (${r2.player.x.toFixed(1)}, ${r2.player.z.toFixed(1)})`);
check('[P2] 読み込んだ状態から目的表示が復元される', r2.objective === beforeReload.objective, r2.objective);

// 壊れた記録
await page.evaluate(() => localStorage.setItem('yui-no-yakusoku:save:1', '{"format":"yui-no-yakusoku-save","version":1,"story":'));
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
await waitMode('title');
const b1 = await titleState();
check('[P2] 壊れた記録は読み込まずに知らせる（タイトル画面。「つづきから」は選べない）', /読み込めませんでした/.test(b1.status) && b1.items.includes('continue:disabled'), b1.status);
await startFromTitle('new');
const b2 = await waitFor2((s) => s.mode === 'explore');
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
await skipScenes();
const nw = await waitFor2((s) => !s.notice && s.mode === 'explore');
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
    // Phase 5：屋根の見た目は状態（old / renewed / partial / worn）で表す
    const roof = (id) => g.world.roofState(id) ?? null;
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
      villagers: g.roofDay.root.visible && g.roofDay.current !== null,
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
const q4d1 = await waitP4((s) => s.notice && /段取りが決まった/.test(s.noticeTitle));
const q4d1body = await page.evaluate(() => document.querySelector('.notice-layer .menu-body')?.textContent ?? '');
const q4d1toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '));
check('[P6] 決めた時点では「段取りが決まった・準備が整った」と出て、「葺き替えた」とは出ない（通知にも出ない）',
  q4d1.chapter === 'roofDay' && /準備が整った/.test(q4d1body) && !/葺き替え/.test(q4d1body + q4d1toasts) &&
  !(await page.evaluate(() => ['renewed', 'partial'].includes(window.__yui.story.currentStage('sae.roof')))),
  `${q4d1body} | ${q4d1toasts}`);
await page.screenshot({ path: `${OUT}/shot-50-decided.png` });
await page.click('.notice-layer .menu-item[data-id="ok"]');
const q4d1b = await page.evaluate(() => ({ mode: window.__yui.mode, title: document.querySelector('.transition-title')?.textContent ?? '', lines: document.querySelector('.transition-lines')?.textContent ?? '' }));
check('[P6] 「作業の日を迎える」で、屋根葺きの日の朝の様子（来ている人・茅・足場）が示される',
  q4d1b.mode === 'transition' && /屋根葺きの日/.test(q4d1b.title) && /宗平さん/.test(q4d1b.lines) && /ミネさんの茅/.test(q4d1b.lines) && /南面いっぱい/.test(q4d1b.lines), q4d1b.lines);
// 低 FPS では短い間隔の 2 回の押下が 1 フレームにまとまるので、画面の変化を確かめながら 1 回ずつ押す
for (let i = 0; i < 20 && (await gameMode()) === 'transition'; i++) {
  await page.keyboard.press('Enter');
  await wait(400);
}
const q4d1c = await waitMode('cinematic', 3000);
check('[P6] 村に出る前に、作業の場を短く見渡す（数秒）', q4d1c === 'cinematic', String(q4d1c));
await page.screenshot({ path: `${OUT}/shot-50b-roofday-shot.png` });
const q4d1d = await waitMode('explore', 8000);
check('[P6] 見渡しは数秒で終わり、自分で歩ける', q4d1d === 'explore', String(q4d1d));
const q4d2 = await waitP4((s) => !s.notice && s.mode === 'explore');
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
check('[P6] 一日を終えてはじめて、手帳に「葺き替えた」が記録される',
  await page.evaluate(() => ['renewed', 'partial'].includes(window.__yui.story.currentStage('sae.roof'))));
await page.click('.result-layer .plan-pick');
const q4h1 = await page.evaluate(() => ({ mode: window.__yui.mode, text: document.querySelector('.history-layer .result-body')?.textContent ?? '' }));
check('[P6] 結果画面から「選んだことの記録」を開ける（選んだこと・承知した人・結果）',
  q4h1.mode === 'history' && /選んだこと/.test(q4h1.text) && /承知した/.test(q4h1.text) && /その結果/.test(q4h1.text), q4h1.text.slice(0, 120));
await page.screenshot({ path: `${OUT}/shot-52b-history.png` });
await page.keyboard.press('Escape');
await wait(300);
check('[P6] 記録を閉じると結果画面に戻る', (await gameMode()) === 'result');
await page.keyboard.press('Enter');
await waitMode('transition');
await wait(1500);
const q4d4 = await page.evaluate(() => ({ mode: window.__yui.mode, title: document.querySelector('.transition-title')?.textContent ?? '', lines: document.querySelector('.transition-lines')?.textContent ?? '', chapter: window.__yui.story.chapter }));
check('[P4] 結果の後、暗転して「三年後の秋」に移り、三年のあいだのことが一行ずつ示される',
  /三年後/.test(q4d4.title) && /三年前の秋/.test(q4d4.lines) && /伊助家の屋根/.test(q4d4.lines), JSON.stringify(q4d4));
await page.screenshot({ path: `${OUT}/shot-53-three-years.png` });
await skipScenes();
const q4c1 = await waitP4((s) => !s.notice && s.chapter === 'ch3' && s.mode === 'explore');
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
check('[P6] エンディングは点数ではなく、実現したこと・残ったこと・約束のゆくえで振り返る',
  /実現したこと/.test(q4e1.endingText) && /残ったこと/.test(q4e1.endingText) && /約束のゆくえ/.test(q4e1.endingText) && /果たした/.test(q4e1.endingText) && !/点数|ランク/.test(q4e1.endingText));
await page.click('.ending-layer [data-action="history"]');
const q4h2 = await page.evaluate(() => ({ mode: window.__yui.mode, acts: [...document.querySelectorAll('.history-act')].map((a) => a.dataset.plan) }));
check('[P6] エンディングから「選んだことの記録」を開くと、第1幕と第3幕の両方が並ぶ', q4h2.mode === 'history' && JSON.stringify(q4h2.acts) === JSON.stringify(['roof', 'isukeRoof']), JSON.stringify(q4h2));
await page.keyboard.press('Escape');
await waitMode('ending');
await page.click('.ending-layer [data-action="explain"]');
const q4x1 = await waitP4((s) => s.explain);
check('[P4] エンディングから「史実と創作について」を開ける（事実・確認中・単純化・架空・創作した設定・出典）',
  q4x1.explain && /資料で確認できる事実/.test(q4x1.explainText) && /合力/.test(q4x1.explainText) && /単純化/.test(q4x1.explainText) &&
  /架空の人物/.test(q4x1.explainText) && /物語のために作った設定/.test(q4x1.explainText) && /出典は確認中/.test(q4x1.explainText) && /mlit\.go\.jp/.test(q4x1.explainText));
await page.screenshot({ path: `${OUT}/shot-55-explain.png` });
await page.keyboard.press('Escape');
await waitMode('ending');
check('[P6] 解説を閉じるとエンディングに戻る', (await gameMode()) === 'ending');
await page.keyboard.press('Enter');
const q4x2 = await waitP4((s) => !s.explain && s.mode === 'explore');
check('[P4] 閉じると村に戻り、物語の終わりが目的に出る', q4x2.mode === 'explore' && /物語はここまで/.test(q4x2.objective) && q4x2.isukeRoof === q4x2.saeRoof, q4x2.objective);

// ── 記録 → 再読み込み → 続きから ──
await page.keyboard.press('Escape');
await waitFor2((s) => s.pause);
await page.click('.pause-layer .menu-item[data-id="save"]');
await waitFor2((s) => /記録しました/.test(s.pauseStatus));
await press2('Escape', (s) => !s.pause);
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
await startFromTitle('continue');
const q4r4 = await waitP4((s) => !s.notice && s.mode === 'explore');
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
  // 結末の後も、家に上がって結帳を見返せる（Phase 5.5）
  const q4in = await enterSaeHouse();
  check(`[P4] ${q4tag} 結末の後も、サエ家に上がれる`, q4in.indoor, JSON.stringify(q4in));
  await place(1.4, -3.9, Math.PI);
  await waitFor((u) => u.target === 'ledger');
  await press('KeyE', (u) => u.dialogueVisible);
  await finishDialogue();
  const q4lg3 = await waitFor2((s) => s.ledger);
  const q4ll = await layout('.ledger', '.ledger-item-line', '.ledger-body');
  check(`[P4] ${q4tag} 結帳：画面に収まり、今年と三年後の記録が書き加わっている`, fits(q4ll, 16) && /今年の秋/.test(q4lg3.ledgerText) && /三年後の秋/.test(q4lg3.ledgerText), JSON.stringify(q4ll));
  if (w === 1280) await page.screenshot({ path: `${OUT}/shot-56-ledger-end.png` });
  await press2('Escape', (s) => !s.ledger);
  const q4out = await leaveSaeHouse();
  check(`[P4] ${q4tag} 結帳を見た後、外に出られる`, !q4out.indoor, JSON.stringify(q4out));
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
  // Phase 6：解説を閉じるとポーズに戻る。設定・選んだことの記録も画面に収まる
  await waitMode('pause');
  await page.click('.pause-layer .menu-item[data-id="settings"]');
  await waitMode('settings');
  const q6st = await layout('.settings-panel', '.settings-label', '.settings-panel');
  check(`[P6] ${q4tag} 設定：画面に収まり、文字は16px以上`, fits(q6st, 16), JSON.stringify(q6st));
  if (w === 1280) await page.screenshot({ path: `${OUT}/shot-57-settings.png` });
  await page.keyboard.press('Escape');
  await waitMode('pause');
  await page.click('.pause-layer .menu-item[data-id="history"]');
  await waitMode('history');
  const q6hs = await layout('.history-layer .result', '.history-layer .result-block li', '.history-layer .result-body');
  check(`[P6] ${q4tag} 選んだことの記録：画面に収まる`, fits(q6hs, 16), JSON.stringify(q6hs));
  await page.keyboard.press('Escape');
  await waitMode('pause');
  await page.keyboard.press('Escape');
  await waitMode('explore');
}
await page.setViewport({ width: 1280, height: 720 });
await wait(600);

// ───────── Phase 5：3D の見た目（建物・人物・屋根葺きの日）と、操作が壊れていないこと ─────────
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await wait(2500);
await startFromTitle('new');
await page.mouse.click(640, 360);

const p5 = () =>
  page.evaluate(() => {
    const g = window.__yui;
    const meshes = (root) => {
      let n = 0;
      root.traverseVisible((o) => { if (o.isMesh) n++; });
      return n;
    };
    const stage = g.roofDay.current;
    return {
      chapter: g.story.chapter,
      mode: g.mode,
      area: g.area,
      target: g.interaction.target?.id ?? null,
      active: g.interaction.isActive,
      roofs: { sae: g.world.roofState('sae'), isuke: g.world.roofState('isuke') },
      styles: Object.fromEntries([...g.npcViews].map(([id, v]) => [id, v.style])),
      npcMeshes: Object.fromEntries([...g.npcViews].map(([id, v]) => [id, meshes(v.root)])),
      where: Object.fromEntries(g.interaction.interactables.filter((i) => i.kind === 'npc').map((i) => [i.id, [i.position.x, i.position.z]])),
      roofDayVisible: g.roofDay.root.visible,
      stage: stage ? { outcome: stage.outcome, roles: stage.roles, crew: stage.crew.length, piles: stage.piles.map((p) => p.id), extent: stage.extent } : null,
      crewRoots: g.roofDay.root.children.filter((c) => c.name.startsWith('crew:')).length,
      carriers: g.roofDay.carriers.map((c) => [c.x, c.z]),
      colliders: g.world.colliders.length,
      player: [g.player.x, g.player.z],
      calls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
    };
  });
const waitP5 = async (cond, timeoutMs = 8000) => {
  const t0 = Date.now();
  let s = await p5();
  while (!cond(s) && Date.now() - t0 < timeoutMs) { await wait(100); s = await p5(); }
  return s;
};
/** 状態だけで第1幕の計画を決める（UI を通した決定は [P4] で確認済み）。 */
const decideRoofState = (plan) =>
  page.evaluate((plan) => {
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
    // 作業台で決めたときと同じ流れ（屋根葺きの日の知らせが出る）
    g.decidePlan();
    return s.outcome() ?? null;
  }, plan);
const closeNoticeOk = async () => {
  await waitP5((s) => s.mode === 'notice');
  await page.click('.notice-layer .menu-item[data-id="ok"]');
  // Phase 6：屋根葺きの日の朝の様子（時間経過の画面）と、短い見渡しを進める
  await skipScenes();
  await waitP5((s) => s.mode === 'explore');
};

// ── 第1幕：建物・人物 ──
const q5a = await p5();
const idle = { toki: 'fidget', sae: 'handsFront', isuke: 'lookField', sohei: 'armsCrossed', mine: 'holdBook' };
check('[P5] 5 人の住民が、それぞれの待機の型で立っている（全員が同じ棒立ちではない）',
  JSON.stringify(q5a.styles) === JSON.stringify(idle), JSON.stringify(q5a.styles));
check('[P5] 住民のモデルは部位ごとにまとめられている（体 8 回＋持ち物 1 回以内の描画）',
  Object.values(q5a.npcMeshes).every((n) => n >= 8 && n <= 9), JSON.stringify(q5a.npcMeshes));
check('[P5] 第1幕：サエ家の屋根は傷んだ見た目、伊助家はふつう、当日の作業の場はない',
  q5a.roofs.sae === 'old' && q5a.roofs.isuke === 'old' && !q5a.roofDayVisible, JSON.stringify(q5a.roofs));

// 5 地点：近くに立つと地点名が出る
const AREAS = { southPlaza: [0, 17], saeHouse: [-11, 0], isukeHouse: [28, 2], soheiWorkshop: [0, -19], mineHouse: [-17, -2] };
const reachedAreas = [];
for (const [id, [x, z]] of Object.entries(AREAS)) {
  await place(x, z, Math.PI);
  const s = await waitP5((v) => v.area === id, 4000);
  if (s.area === id) reachedAreas.push(id);
}
check('[P5] 5 地点すべてで地点の判定が働く', reachedAreas.length === 5, reachedAreas.join(','));

// 調べられる物・住民のすべてに、正面から近づいて操作できる（モデルの大きさを変えても判定がずれていない）
// 屋外の対象（室内の結帳・囲炉裏・入口は [P2]・[P5.5] で、家に入ってから確かめる）
const targets = await page.evaluate(() => window.__yui.interaction.interactables.filter((i) => !i.indoor).map((i) => ({ id: i.id, x: i.position.x, z: i.position.z, range: i.range })));
const operated = [];
const notOperated = [];
for (const t of targets) {
  let ok = false;
  for (let k = 0; k < 8 && !ok; k++) {
    const a = (k / 8) * Math.PI * 2;
    const d = Math.min(1.4, t.range - 0.5);
    const px = t.x + Math.sin(a) * d;
    const pz = t.z + Math.cos(a) * d;
    await place(px, pz, a + Math.PI);
    await wait(250);
    const v = await p5();
    if (v.target !== t.id) continue;
    await page.keyboard.press('KeyE');
    const opened = await waitP5((s) => s.mode !== 'explore', 3000);
    ok = opened.mode !== 'explore';
    // 開いた画面（会話・作業台・結帳）を閉じる
    for (let i = 0; i < 6 && (await p5()).mode !== 'explore'; i++) {
      await page.keyboard.press('Escape');
      await wait(300);
    }
  }
  (ok ? operated : notOperated).push(t.id);
}
check(`[P5] 住民 5 人と調べられる物すべて（${targets.length} 件）に近づいて操作できる`, notOperated.length === 0, `ok=${operated.join(',')} / ng=${notOperated.join(',')}`);

const q5calls1 = await (async () => {
  await place(0, 31, Math.PI);
  await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; o.pitch = o.targetPitch = 0.42; o.distance = o.targetDistance = 10; });
  await wait(800);
  return p5();
})();
await page.screenshot({ path: `${OUT}/shot-60-p5-start.png` });

// ── 屋根葺きの日：計画ごとに、来ている人・茅の山・足場が変わる ──
const P5_PLANS = {
  'solo-part': { date: 'keep', isuke: 'none', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
  'prep-full': { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
  'wait-full': { date: 'afterHarvest', isuke: 'dayOf', offer: 'none', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
};
let q5roofDayCalls = 0;
for (const [id, plan] of Object.entries(P5_PLANS)) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);
  await startFromTitle('new');
  const decided = await decideRoofState(plan);
  await closeNoticeOk();
  const s = await waitP5((v) => v.roofDayVisible);
  const delayed = id.startsWith('wait');
  const full = id.endsWith('full');
  const rolesOk =
    s.stage?.outcome === id &&
    s.styles.sohei === 'direct' &&
    (s.styles.isuke === 'carry') === delayed &&
    (s.styles.mine === 'holdKaya') === (full && !delayed) &&
    Object.keys(s.stage.roles).sort().join(',') === ['sohei', ...(delayed ? ['isuke'] : []), ...(full && !delayed ? ['mine'] : [])].sort().join(',');
  check(`[P5] 当日（${id}）：決めた計画の結果になり、来ている住民と役割が計画と一致する`, decided === id && rolesOk, JSON.stringify({ decided, styles: s.styles, roles: s.stage?.roles }));
  // 来ていない住民は作業の場にいない（伊助は畑、ミネは自宅）
  const farFromSite = (xz) => Math.hypot(xz[0], xz[1] - 10) > 12;
  check(`[P5] 当日（${id}）：参加していない住民は作業の場にいない`,
    (delayed || farFromSite(s.where.isuke)) && ((full && !delayed) || farFromSite(s.where.mine)), JSON.stringify(s.where));
  check(`[P5] 当日（${id}）：茅の山・足場の範囲・手伝いの人数が計画に合う`,
    s.stage.extent === (full ? 'full' : 'part') && s.stage.piles.includes('mine') === full && s.crewRoots === s.stage.crew && s.crewRoots >= 3,
    JSON.stringify({ ...s.stage, crewRoots: s.crewRoots }));
  // 茅を運ぶ人が動く
  // ソフトウェア描画ではゲーム内の時間の進みが遅いので、動き出すまで最大 15 秒待つ
  const c0 = s.carriers;
  const movedNow = (c1) => c0.some((p, i) => Math.hypot(p[0] - c1[i][0], p[1] - c1[i][1]) > 0.2);
  const c1 = (await waitP5((v) => movedNow(v.carriers), 15000)).carriers;
  const moved = movedNow(c1);
  check(`[P5] 当日（${id}）：茅を運ぶ人が往復している`, moved, JSON.stringify({ c0, c1 }));
  await place(0, 22, Math.PI);
  await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; o.pitch = o.targetPitch = 0.35; o.distance = o.targetDistance = 16; });
  await wait(1200);
  const shotState = await p5();
  q5roofDayCalls = Math.max(q5roofDayCalls, shotState.calls);
  await page.screenshot({ path: `${OUT}/shot-61-p5-roofday-${id}.png` });
}

// 茅を運ぶ人は、プレイヤーが通り道にいると立ち止まる（すり抜け・押し出しが起きない）
// 運ぶ人が茅の山の側にいる間に、梯子の側の端（の少し先）にプレイヤーを立たせ、近づいてきた運ぶ人が手前で止まるか見る
{
  const path = await page.evaluate(() => {
    const c = window.__yui.roofDay.carriers[0];
    return { from: c.from, to: c.to };
  });
  const atPile = () => page.evaluate(() => {
    const c = window.__yui.roofDay.carriers[0];
    return c.phase === 'load' || (c.phase === 'back' && Math.hypot(c.x - c.from.x, c.z - c.from.z) < 0.3);
  });
  for (let i = 0; i < 150 && !(await atPile()); i++) await wait(100);
  const len = Math.hypot(path.to.x - path.from.x, path.to.z - path.from.z);
  const stand = { x: path.to.x + ((path.to.x - path.from.x) / len) * 0.3, z: path.to.z + ((path.to.z - path.from.z) / len) * 0.3 };
  await place(stand.x, stand.z, 0);
  // 運ぶ人が歩き出して、プレイヤーの手前で止まる（2 秒間動かない）まで見る（最大 30 秒）
  let minDist = Infinity;
  let pushed = 0;
  let walked = false;
  let lastC = null;
  let stillFor = 0;
  for (let i = 0; i < 150 && !(walked && stillFor >= 10); i++) {
    await wait(200);
    const s = await p5();
    const c = s.carriers[0];
    minDist = Math.min(minDist, Math.hypot(c[0] - s.player[0], c[1] - s.player[1]));
    pushed = Math.max(pushed, Math.hypot(s.player[0] - stand.x, s.player[1] - stand.z));
    const phase = await page.evaluate(() => window.__yui.roofDay.carriers[0].phase);
    if (phase === 'out') walked = true;
    stillFor = lastC && walked && Math.hypot(c[0] - lastC[0], c[1] - lastC[1]) < 0.005 ? stillFor + 1 : 0;
    lastC = c;
  }
  check('[P5] 茅を運ぶ人は、通り道に立つプレイヤーの手前で止まり、押し出さない',
    walked && stillFor >= 10 && minDist > 0.9 && minDist < 1.5 && pushed < 0.05,
    `歩き出した ${walked} / 止まった ${stillFor >= 10} / 最小距離 ${minDist.toFixed(2)} / プレイヤーの移動 ${pushed.toFixed(2)}`);
}

// 当日の住民と話せる（宗平：段取りを指示している）
await talkTo('sohei', -4.8, 12.4, Math.PI);
check('[P5] 当日、段取りをしている宗平と話せる', (await page.evaluate(() => window.__yui.story.flagList())).includes('talked:sohei'));

// ── 三年後：作業の場は片付き、サエは杖をつく。屋根の見た目が変わる ──
await page.evaluate(() => {
  const g = window.__yui;
  g.story.set('roofDay:ended');
  g.enterChapter3();
});
const q5c = await waitP5((s) => s.chapter === 'ch3');
check('[P5] 第3幕：当日の作業の場は片付き、当たり判定も残らない', !q5c.roofDayVisible && q5c.stage === null && q5c.colliders === q5a.colliders, JSON.stringify({ visible: q5c.roofDayVisible, colliders: [q5a.colliders, q5c.colliders] }));
check('[P5] 第3幕：サエは杖をつき、ほかの住民は普段の立ち姿に戻る',
  q5c.styles.sae === 'cane' && q5c.styles.sohei === 'armsCrossed' && q5c.styles.isuke === 'lookField' && q5c.styles.mine === 'holdBook', JSON.stringify(q5c.styles));
check('[P5] 第3幕：サエ家の南面は葺き替え後（ミネの茅）、伊助家の屋根は傷んでいる',
  q5c.roofs.sae === 'renewed' && q5c.roofs.isuke === 'worn', JSON.stringify(q5c.roofs));
await talkTo('sae', ...SPOT.sae);
check('[P5] 杖をついたサエとも話せる', (await page.evaluate(() => window.__yui.story.flagList())).includes('talked:sae'));
await page.evaluate(() => { const g = window.__yui; g.player.x = 2.6; g.player.z = 13.4; });
await wait(600);
await page.screenshot({ path: `${OUT}/shot-62-p5-ch3-sae.png` });

// 記録して読み込み直しても、見た目（屋根・立ち姿）が戻る
await page.evaluate(() => window.__yui.saveGame());
await page.reload({ waitUntil: 'networkidle0' });
await wait(2000);
await startFromTitle('continue');
const q5r = await waitP5((s) => s.mode === 'explore' && s.chapter === 'ch3');
check('[P5] 再読み込み後も、第3幕の屋根の見た目と、サエの立ち姿が戻る',
  q5r.roofs.sae === 'renewed' && q5r.roofs.isuke === 'worn' && q5r.styles.sae === 'cane' && !q5r.roofDayVisible, JSON.stringify({ roofs: q5r.roofs, styles: q5r.styles }));

// ───────── Phase 5.5：橋の欄干（実際に歩かせる）と、室内での記録・読込 ─────────
{
  const pos = () => page.evaluate(() => ({ x: window.__yui.player.x, z: window.__yui.player.z, indoor: window.__yui.world.indoor }));
  const faceNorth = () => page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; });
  /** 橋の上の z に立って、左右（A/D）へ押し続けたときの x。 */
  const pushSide = async (z, key) => {
    await place(0, z, Math.PI);
    await faceNorth();
    await wait(300);
    await page.keyboard.down(key);
    await wait(2500);
    await page.keyboard.up(key);
    await wait(300);
    return (await pos()).x;
  };
  const results55 = [];
  for (const [where, z] of [['入口側の端', 20.25], ['中央', 23.0], ['出口側の端', 25.75]]) {
    for (const key of ['KeyD', 'KeyA']) {
      const x = await pushSide(z, key);
      results55.push(`${where}${key === 'KeyD' ? '右' : '左'}:${x.toFixed(2)}`);
      check(`[P5.5] 橋の${where}で${key === 'KeyD' ? '右' : '左'}の柵へ歩いても、柵を越えられない`, Math.abs(x) < 1.2, `x=${x.toFixed(2)}`);
    }
  }
  // 正規の入口から出口へ（南→北）、出口から入口へ（北→南）歩いて渡れる
  await place(0, 29, Math.PI);
  await faceNorth();
  const crossN = await holdUntil(['KeyW'], (s) => s.z < 17.5, 20000);
  check('[P5.5] 橋の入口から出口まで歩いて渡れる（南→北）', crossN.z < 17.5, `z=${crossN.z.toFixed(2)}`);
  const crossS = await holdUntil(['KeyS'], (s) => s.z > 28, 20000);
  check('[P5.5] 橋の出口から入口まで歩いて渡れる（北→南）', crossS.z > 28, `z=${crossS.z.toFixed(2)}`);

  // 室内で記録 → 再読み込み → 室内から再開。結帳を調べられ、外にも出られる
  const in1 = await enterSaeHouse();
  await place(-5, -2, 0);
  await wait(400);
  await page.evaluate(() => window.__yui.saveGame());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);
  await startFromTitle('continue');
  await wait(800);
  const in2 = await pos();
  check('[P5.5] 室内で記録して読み込むと、室内の同じ位置から再開する', in1.indoor && in2.indoor && Math.abs(in2.x + 5) < 0.3 && Math.abs(in2.z + 2) < 0.3, JSON.stringify({ in1, in2 }));
  await place(1.4, -3.9, Math.PI);
  const in3 = await waitFor((u) => u.target === 'ledger');
  check('[P5.5] 読み込んだ後も、室内の結帳を調べられる（第3幕）', in3.target === 'ledger', String(in3.target));
  await place(-0.3, 0.4, Math.PI);
  const in3b = await waitFor((u) => u.target === 'irori');
  await press('KeyE', (u) => u.dialogueVisible);
  const in3c = await ui();
  await finishDialogue();
  check('[P5.5] 室内の囲炉裏を調べられる', in3b.target === 'irori' && in3c.dialogueVisible && (await page.evaluate(() => window.__yui.story.flagList())).includes('inspected:irori'), in3c.text);
  const in4 = await leaveSaeHouse();
  check('[P5.5] 読み込んだ後も、室内から外に出られる', !in4.indoor && in4.z > 7, JSON.stringify(in4));
  await page.screenshot({ path: `${OUT}/shot-63-p55-exit.png` });
}

// ───────── Phase 6：音・設定の保存・室内のカメラ・作業台の見比べ・屋根葺きの日の演出 ─────────
{
  // 音：ユーザーの操作の後に鳴り始める。M でミュート、設定は再読み込みしても残る
  const au = () => page.evaluate(() => ({ state: window.__yui.audio.state, muted: window.__yui.settingsStore.value.muted, sens: window.__yui.settingsStore.value.lookSensitivity }));
  await page.mouse.click(640, 360);
  await wait(300);
  const a1 = await au();
  check('[P6] 操作の後、音が鳴る状態になる（自動再生の制限に従い、操作の前は鳴らさない）', a1.state === 'running', JSON.stringify(a1));
  await page.keyboard.press('KeyM');
  await wait(300);
  const a2 = await au();
  const a2toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '));
  check('[P6] M キーで音を消せる（知らせも出る）', a2.muted && /音を消した/.test(a2toast), a2toast);
  // 設定画面（キー操作）：視点の感度を上げる
  await page.keyboard.press('Escape');
  await waitMode('pause');
  await page.click('.pause-layer .menu-item[data-id="settings"]');
  await waitMode('settings');
  // マウスを設定画面の外へ動かしておく（クリックした位置の行が選ばれたままにならないように）
  await page.mouse.move(4, 4);
  await wait(200);
  await page.keyboard.press('ArrowRight');
  await wait(300);
  const a3 = await au();
  const a3cam = await page.evaluate(() => window.__yui.cameraRig.settings.lookSensitivity);
  check('[P6] 設定画面で視点の感度をキーで変えられ、すぐにカメラに反映される', Math.abs(a3.sens - 1.1) < 1e-6 && a3cam > 0.005, JSON.stringify({ a3, a3cam }));
  await page.keyboard.press('Escape');
  await waitMode('pause');
  await page.keyboard.press('Escape');
  await waitMode('explore');
  await page.evaluate(() => window.__yui.saveGame());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);
  const a4 = await page.evaluate(() => ({ muted: window.__yui.settingsStore.value.muted, sens: window.__yui.settingsStore.value.lookSensitivity, mode: window.__yui.mode }));
  check('[P6] 設定（ミュート・視点の感度）は再読み込みしても残る', a4.muted && Math.abs(a4.sens - 1.1) < 1e-6 && a4.mode === 'title', JSON.stringify(a4));
  await page.evaluate(() => window.__yui.settingsStore.update({ muted: false, lookSensitivity: 1 }));
  await startFromTitle('continue');

  // 室内の壁際：カメラは壁と天井の内側に収まり、主人公は消えずに見える
  await enterSaeHouse();
  await place(-7.2, -4.6, Math.PI * 0.75);
  await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.yaw = o.targetYaw = -Math.PI * 0.25; });
  await wait(2500);
  const c1 = await page.evaluate(() => {
    const g = window.__yui;
    const c = g.camera.position;
    const p = g.scene.getObjectByName('player');
    let opacity = 1;
    p.traverse((o) => { if (o.isMesh) opacity = o.material.opacity; });
    return { visible: p.visible, opacity, cam: [c.x, c.y, c.z], dist: g.cameraRig.currentDistance, floor: g.player.y };
  });
  check('[P6] 室内の壁際でも、主人公は消えずに見え、カメラは室内に収まる',
    c1.visible && c1.opacity >= 0.3 && Math.abs(c1.cam[0]) < 8.1 && c1.cam[2] > -5.7 && c1.cam[2] < 5.7 && c1.cam[1] < c1.floor + 3.4, JSON.stringify(c1));
  await page.screenshot({ path: `${OUT}/shot-64-p6-indoor-wall.png` });
  await leaveSaeHouse();

  // 作業台：承諾を得た案が二つ以上あれば、要点を表で見比べられる（正解の印はない）
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);
  await startFromTitle('new');
  await page.evaluate(() => {
    const g = window.__yui;
    const s = g.story;
    const learn = [
      ['sae.schedule', 'needsHelp'], ['sae.dateReason', 'burden'], ['sae.roof', 'worn'], ['sae.kaya', 'short'],
      ['isuke.field', 'progress'], ['isuke.availability', 'dayBefore'], ['isuke.pastHelp', 'isukeView'],
      ['sohei.schedule', 'kayaCutting'], ['mine.kaya', 'whyRecord'], ['mine.cutting', 'canLead'], ['ledger.basics', 'read'],
    ];
    for (const [t, st] of learn) s.learn(t, st);
    for (const plan of [
      { date: 'keep', isuke: 'none', offer: 'none', kaya: 'own', kayaReturn: 'none', soheiCover: 'none' },
      { date: 'afterHarvest', isuke: 'dayOf', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'mineCovers' },
      { date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' },
    ]) {
      s.setPlanDraft(plan);
      for (const npc of s.planInvolved()) s.consultPlan(npc);
    }
    g.openPlanBoard();
  });
  await waitMode('plan');
  for (const [w, h] of [[1280, 720], [1024, 640]]) {
    await page.setViewport({ width: w, height: h });
    await wait(600);
    const pc = await page.evaluate(() => ({
      glance: [...document.querySelectorAll('.plan-glance dt')].map((d) => d.textContent),
      cols: document.querySelectorAll('.plan-compare-table tr:first-child th').length - 1,
      rows: document.querySelectorAll('.plan-compare-table tr').length - 1,
      responses: document.querySelectorAll('.plan-response').length,
      text: document.querySelector('.plan-body')?.textContent ?? '',
    }));
    const pl = await layout('.plan', '.plan-compare-table td', '.plan-body');
    check(`[P6] ${w}x${h} 作業台：要点（いつ・どこまで・加わる人・負担・約束）と、承諾を得た3つの案の見比べ表が出て、画面に収まる`,
      JSON.stringify(pc.glance) === JSON.stringify(['いつ', '屋根をどこまで', '加わる人', '負担が重くなる人', '残る約束・返し']) &&
      pc.cols === 3 && pc.rows === 5 && pc.responses > 0 && !/おすすめ|正解/.test(pc.text) && fits(pl, 16), JSON.stringify({ ...pc, text: undefined, pl }));
    await page.screenshot({ path: `${OUT}/shot-65-p6-compare-${w}.png` });
  }
  await page.setViewport({ width: 1280, height: 720 });
  await wait(400);
  await page.keyboard.press('Escape');
  await waitMode('explore');

  // 屋根葺きの日：作業が進み、近くを通ると住民がひと言いう。作業の音は作業の場の近くで鳴る
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);
  await startFromTitle('new');
  await page.mouse.click(640, 360);
  await decideRoofState({ date: 'keep', isuke: 'dayBefore', offer: 'harvestHelp', kaya: 'mine', kayaReturn: 'nextYearRecorded', soheiCover: 'none' });
  await closeNoticeOk();
  const r1 = await page.evaluate(() => window.__yui.roofDayElapsed);
  await place(-4.6, 12.6, Math.PI);
  let bubble = null;
  for (let i = 0; i < 40 && !bubble; i++) {
    await wait(200);
    bubble = await page.evaluate(() => { const b = document.querySelector('.speech-bubble'); return b && !b.hidden ? b.textContent : null; });
  }
  check('[P6] 屋根葺きの日、住民の近くを通ると頭上にひと言が出る（会話ウィンドウは開かない）', !!bubble && (await gameMode()) === 'explore', String(bubble));
  await page.evaluate(() => { const o = window.__yui.cameraRig.orbit; o.yaw = o.targetYaw = Math.PI; });
  await wait(800);
  await page.screenshot({ path: `${OUT}/shot-66-p6-roofday-bark.png` });
  const r2 = await page.evaluate(() => ({ elapsed: window.__yui.roofDayElapsed, work: window.__yui.audio.work }));
  check('[P6] 屋根葺きの日は時間とともに作業が進み、作業の場の近くでは作業の音が鳴る', r2.elapsed > r1 && r2.work.volume > 0.3 && r2.work.interval < 1.5, JSON.stringify({ r1, r2 }));
  const r3 = await page.evaluate(() => { const g = window.__yui; g.player.x = 0; g.player.z = 38; return true; });
  await wait(600);
  const r4 = await page.evaluate(() => window.__yui.audio.work.volume);
  check('[P6] 作業の場から離れると作業の音は小さくなる', r3 && r4 < r2.work.volume, String(r4));
}

// 描画負荷（ソフトウェア描画のため FPS は参考にならない。描画呼び出し数で確認する）
check('[P5] 描画呼び出し数が極端に増えていない（第1幕 300 以下・屋根葺きの日 450 以下）',
  q5calls1.calls <= 300 && q5roofDayCalls <= 450, `第1幕 ${q5calls1.calls} / 屋根葺きの日 ${q5roofDayCalls}`);

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
