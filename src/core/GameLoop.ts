/**
 * requestAnimationFrame による更新ループ。
 * 経過時間は上限付きで渡す（タブ復帰時などの巨大な dt で壁をすり抜けないように）。
 */
export const MAX_FRAME_DT = 0.1;

export function clampFrameDt(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, MAX_FRAME_DT);
}

export class GameLoop {
  private handle = 0;
  private last = 0;
  private running = false;

  constructor(private readonly tick: (dt: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = clampFrameDt((now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.handle = requestAnimationFrame(frame);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}
