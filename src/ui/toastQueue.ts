/**
 * 短い通知の表示待ちの列（レビュー指摘 2）。DOM に依存しない。
 *
 * - 同時に出すのは maxVisible 件まで。あふれた分は表示待ちに並べ、空いた枠へ順に出す（順序を保つ）。
 * - 表示時間は、通知が見えている間だけ進める（画面を開いて隠れている間は止める＝見る前に消えない）。
 * - 表示中・表示待ちと同じ内容は、重ねて並べない（二重に出さない）。
 * - 表示待ちが maxPending 件を超えたら、古いものから捨てる（無制限にたまらない）。
 */
export interface ToastItem {
  readonly label: string;
  readonly text: string;
}

export interface ToastTick<T extends ToastItem> {
  /** この更新で新しく出す通知（出す順）。 */
  readonly shown: T[];
  /** この更新で表示時間が終わった通知。 */
  readonly expired: T[];
}

export class ToastQueue<T extends ToastItem = ToastItem> {
  private visibleItems: Array<{ item: T; left: number }> = [];
  private pendingItems: T[] = [];
  private droppedCount = 0;

  constructor(
    readonly maxVisible = 2,
    readonly duration = 3.2,
    readonly maxPending = 12,
  ) {}

  get visible(): readonly T[] {
    return this.visibleItems.map((v) => v.item);
  }

  get pending(): readonly T[] {
    return this.pendingItems;
  }

  /** 表示待ちがあふれて捨てた数（確認用）。 */
  get dropped(): number {
    return this.droppedCount;
  }

  push(item: T): void {
    const same = (x: T) => x.label === item.label && x.text === item.text;
    if (this.visibleItems.some((v) => same(v.item)) || this.pendingItems.some(same)) return;
    this.pendingItems.push(item);
    while (this.pendingItems.length > this.maxPending) {
      this.pendingItems.shift();
      this.droppedCount++;
    }
  }

  /**
   * 時間を進める。paused の間（通知が隠れている間）は表示時間を進めず、新しく出しもしない。
   */
  tick(dt: number, paused: boolean): ToastTick<T> {
    const expired: T[] = [];
    const shown: T[] = [];
    if (paused) return { shown, expired };
    for (const v of this.visibleItems) v.left -= dt;
    this.visibleItems = this.visibleItems.filter((v) => {
      if (v.left > 0) return true;
      expired.push(v.item);
      return false;
    });
    while (this.visibleItems.length < this.maxVisible && this.pendingItems.length > 0) {
      const item = this.pendingItems.shift()!;
      this.visibleItems.push({ item, left: this.duration });
      shown.push(item);
    }
    return { shown, expired };
  }

  clear(): void {
    this.visibleItems = [];
    this.pendingItems = [];
  }
}
