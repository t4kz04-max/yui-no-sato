/**
 * 会話中の通知の出し方（Phase 7・U03）。DOM・Three.js に依存しない。
 *
 * 会話の効果（承諾・手帳の記録・約束）は、場面に入った瞬間・選択肢を選んだ瞬間に状態へ反映される。
 * 状態の更新はそのままにして、**画面への通知だけ**を、その結果を伝える場面を読み終えて先へ進んだとき
 * （または会話が終わったとき）に出す。「しばらく案を見つめていた」のような間の場面（分岐するだけの場面）では出さない。
 *
 * - 通知は「起きた時点で表示していた場面」を覚える。それより後に表示した、内容のある場面を離れたときに出す。
 * - 会話が終わったら、残りをすべて出す（出し漏れがない）。出したものは消す（二重に出さない）。
 * - 送りを速くしても、場面の切り替わりの順に処理するので順序は逆転しない。
 */
export interface Notice<S = string> {
  readonly label: string;
  readonly text: string;
  readonly sound?: S;
}

export class NoticeQueue<S = string> {
  private deferring = false;
  /** 今表示している場面の番号（会話の最初の場面が 1）。 */
  private visit = 0;
  private items: Array<{ notice: Notice<S>; visit: number }> = [];
  private refresh = false;

  /** 会話を始める直前に呼ぶ（最初の場面の効果も溜める）。 */
  begin(): void {
    this.deferring = true;
    this.visit = 0;
    this.items = [];
    this.refresh = false;
  }

  get active(): boolean {
    return this.deferring;
  }

  /** 通知を溜める。会話中でなければ false（呼び出し側がすぐ出す）。 */
  push(notice: Notice<S>): boolean {
    if (!this.deferring) return false;
    this.items.push({ notice, visit: this.visit });
    return true;
  }

  /** 目的表示・手帳の新着の更新を、通知と一緒に行う。会話中でなければ false（すぐ更新する）。 */
  deferRefresh(): boolean {
    if (!this.deferring) return false;
    this.refresh = true;
    return true;
  }

  /**
   * 次の場面を表示したときに呼ぶ。
   * @param leftContent 離れた場面が内容のある場面か（分岐するだけの間の場面・何も表示していないときは false）
   * @returns 今出す通知と、目的表示などを更新するか
   */
  nodeChanged(leftContent: boolean): { notices: Notice<S>[]; refresh: boolean } {
    const left = this.visit;
    this.visit++;
    if (!this.deferring || !leftContent) return { notices: [], refresh: false };
    const ready = this.items.filter((i) => i.visit < left);
    if (ready.length === 0) return { notices: [], refresh: false };
    this.items = this.items.filter((i) => i.visit >= left);
    // 目的表示は、溜めた通知がすべて出るまで更新しない（後で出す結果が目的の文言から先に分からないように）
    const refresh = this.refresh && this.items.length === 0;
    if (refresh) this.refresh = false;
    return { notices: ready.map((i) => i.notice), refresh };
  }

  /** 会話が終わったとき（中断を含む）。残りをすべて返す。 */
  end(): { notices: Notice<S>[]; refresh: boolean } {
    const out = { notices: this.items.map((i) => i.notice), refresh: this.refresh };
    this.deferring = false;
    this.items = [];
    this.refresh = false;
    return out;
  }
}
