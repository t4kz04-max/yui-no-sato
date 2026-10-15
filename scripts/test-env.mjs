/**
 * ブラウザテストの実行環境の見張り（Phase 8）。
 *
 * 2026-10-15 のフルテストの途中終了は、PC のモダン スタンバイ（Windows の Kernel-Power 506／507）と時刻が一致した。
 * スタンバイ中はテスト用の Chrome と Node が止まり、明けたときに CDP の接続が切れて
 * 「detached Frame」「Session closed」で終わる。ゲームやテストの不具合と区別できるように、次を行う。
 *
 * - keepAwake：テストの実行中だけ、Windows にスリープ・画面オフをしないよう求める（SetThreadExecutionState）。
 *   テストが終われば（親の Node が終われば）元に戻る。電源設定そのものは変えない。
 * - watchClock：実時間が大きく飛んだ（＝PC が止まっていた）ことを検出して記録する。
 * - describeStall：途中終了の報告に、止まっていた時間を添える。
 */
import { spawn } from 'node:child_process';

/** テストの実行中だけ、スリープと画面オフを抑える（Windows 以外では何もしない）。 */
export function keepAwake() {
  if (process.platform !== 'win32' || process.env.NO_KEEP_AWAKE) return () => undefined;
  // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED。親（このテスト）が終わったら自分も終わる
  const script = `
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$api = Add-Type -MemberDefinition $sig -Name 'Power' -Namespace 'YuiTest' -PassThru
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
  [void]$api::SetThreadExecutionState([uint32]2147483651)
  Start-Sleep -Seconds 20
}
[void]$api::SetThreadExecutionState([uint32]2147483648)
`;
  let child = null;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
  } catch {
    return () => undefined;
  }
  const stop = () => {
    try {
      child?.kill();
    } catch {
      // 終わっていれば何もしない
    }
  };
  process.on('exit', stop);
  return stop;
}

/** 実時間の飛び（PC の停止）を記録する。gaps には [何時に, 何秒] が入る。 */
export function watchClock(intervalMs = 2000, thresholdSec = 30) {
  const gaps = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = (now - last - intervalMs) / 1000;
    if (gap > thresholdSec) gaps.push([new Date(last).toLocaleTimeString('ja-JP'), Math.round(gap)]);
    last = now;
  }, intervalMs);
  timer.unref();
  return {
    gaps,
    describe() {
      return gaps.length
        ? `実行中に PC が止まっていた時間がある（スリープ等の疑い）：${gaps.map(([t, s]) => `${t} から約 ${s} 秒`).join('、')}`
        : '実行中に PC が止まっていた形跡はない';
    },
  };
}
