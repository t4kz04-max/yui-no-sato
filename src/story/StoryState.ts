import type { EventSink } from '../core/EventBus';
import type { Effect, StoryQuery } from './conditions';
import type {
  ConsentEntry,
  ConsentStatus,
  FlagId,
  HouseholdId,
  LearnedStage,
  NpcId,
  PromiseRecord,
  RequestId,
  StageId,
  StoryDefinitions,
  StorySnapshot,
  TopicId,
} from './types';

export interface StoryEvents {
  /** フラグが新しく立った（既に立っていた場合は通知しない）。 */
  flagSet: { readonly flag: FlagId };
  /** 情報を新しく得た、または段階が進んだ。 */
  topicLearned: { readonly topic: TopicId; readonly stage: StageId; readonly previous: StageId | null };
  consentChanged: {
    readonly npc: NpcId;
    readonly request: RequestId;
    readonly status: ConsentStatus;
    readonly previous: ConsentStatus | null;
  };
  npcMet: { readonly npc: NpcId };
  promiseRecorded: { readonly id: string };
  /** 記録の読込・最初からやり直しで状態全体が置き換わった。 */
  storyRestored: Record<string, never>;
}

/** 効果を適用するときの文脈（どこで起きたか。手帳の「経緯」に表示する）。 */
export interface EffectContext {
  readonly source?: string;
}

/**
 * プレイヤーが知ったこと・行ったこと・住民の意向・約束の記録（ゲーム状態）。
 * 3D 描画にも DOM にも依存しない。すべての変更はこのクラスのメソッドを通し、変更は通知される。
 *
 * 一貫性のための規則：
 * - 情報の段階は進むだけ。後の段階を知った後で前の段階を得ても無視する（取得順序で矛盾しない）。
 * - 住民の意向は本人が表明したときだけ変わり、履歴が残る。過去の協力（結帳）とは別に持つ。
 * - 定義にない ID は受け付けない（データの誤りを早く見つける）。
 */
export class StoryState implements StoryQuery {
  private clock = 0;
  private readonly flags = new Set<FlagId>();
  private readonly learned = new Map<TopicId, LearnedStage[]>();
  private readonly met = new Set<NpcId>();
  private readonly consents = new Map<NpcId, ConsentEntry[]>();
  private readonly promises: PromiseRecord[] = [];

  constructor(
    readonly defs: StoryDefinitions,
    private readonly events?: EventSink<StoryEvents>,
  ) {}

  // ───────── フラグ ─────────

  has(flag: FlagId): boolean {
    return this.flags.has(flag);
  }

  /** 新しく立ったときだけ true を返す。 */
  set(flag: FlagId): boolean {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    this.tick();
    this.events?.emit('flagSet', { flag });
    return true;
  }

  // ───────── 情報 ─────────

  stageRank(topic: TopicId, stage: StageId): number {
    const def = this.defs.topics[topic];
    if (!def) throw new Error(`未定義の情報 ${topic}`);
    const rank = def.stages.findIndex((s) => s.id === stage);
    if (rank < 0) throw new Error(`情報 ${topic} に段階 ${stage} はありません`);
    return rank;
  }

  topicRank(topic: TopicId): number {
    const list = this.learned.get(topic);
    const last = list?.[list.length - 1];
    return last ? this.stageRank(topic, last.stage) : -1;
  }

  /** 知っている最も進んだ段階。未取得は null。 */
  currentStage(topic: TopicId): StageId | null {
    const list = this.learned.get(topic);
    return list?.[list.length - 1]?.stage ?? null;
  }

  /** その情報を得た経緯（古い順）。 */
  history(topic: TopicId): readonly LearnedStage[] {
    return this.learned.get(topic) ?? [];
  }

  /** 得た情報すべて（取得順）。 */
  allLearned(): LearnedStage[] {
    return [...this.learned.values()].flat().sort((a, b) => a.order - b.order);
  }

  /** 新しく得た・段階が進んだときだけ true。 */
  learn(topic: TopicId, stage: StageId, ctx: EffectContext = {}): boolean {
    const rank = this.stageRank(topic, stage);
    const previous = this.currentStage(topic);
    if (rank <= this.topicRank(topic)) return false;
    const entry: LearnedStage = { topic, stage, order: this.tick(), ...(ctx.source ? { source: ctx.source } : {}) };
    const list = this.learned.get(topic) ?? [];
    list.push(entry);
    this.learned.set(topic, list);
    this.events?.emit('topicLearned', { topic, stage, previous });
    return true;
  }

  // ───────── 住民 ─────────

  hasMet(npc: NpcId): boolean {
    return this.met.has(npc);
  }

  markMet(npc: NpcId): boolean {
    this.requireNpc(npc);
    if (this.met.has(npc)) return false;
    this.met.add(npc);
    this.tick();
    this.events?.emit('npcMet', { npc });
    return true;
  }

  consent(npc: NpcId, request: RequestId): ConsentEntry | undefined {
    const list = this.consents.get(npc);
    if (!list) return undefined;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.request === request) return list[i];
    return undefined;
  }

  consentStatus(npc: NpcId, request: RequestId): ConsentStatus | undefined {
    return this.consent(npc, request)?.status;
  }

  /** 意向の履歴（古い順）。 */
  consentHistory(npc: NpcId): readonly ConsentEntry[] {
    return this.consents.get(npc) ?? [];
  }

  /** 意向を記録する。現在と同じ内容なら何もしない。 */
  setConsent(
    npc: NpcId,
    request: RequestId,
    status: ConsentStatus,
    note?: string,
    ctx: EffectContext = {},
  ): boolean {
    this.requireNpc(npc);
    if (!this.defs.requests[request]) throw new Error(`未定義の依頼 ${request}`);
    const current = this.consent(npc, request);
    if (current && current.status === status && current.note === note) return false;
    const entry: ConsentEntry = {
      request,
      status,
      order: this.tick(),
      ...(note !== undefined ? { note } : {}),
      ...(ctx.source ? { source: ctx.source } : {}),
    };
    const list = this.consents.get(npc) ?? [];
    list.push(entry);
    this.consents.set(npc, list);
    this.events?.emit('consentChanged', { npc, request, status, previous: current?.status ?? null });
    return true;
  }

  // ───────── 約束 ─────────

  allPromises(): readonly PromiseRecord[] {
    return this.promises;
  }

  recordPromise(id: string, from: HouseholdId, to: HouseholdId, content: string, ctx: EffectContext = {}): boolean {
    for (const h of [from, to]) if (!this.defs.households.includes(h)) throw new Error(`未定義の家 ${h}`);
    if (this.promises.some((p) => p.id === id)) return false;
    this.promises.push({ id, from, to, content, order: this.tick(), ...(ctx.source ? { source: ctx.source } : {}) });
    this.events?.emit('promiseRecorded', { id });
    return true;
  }

  // ───────── 効果の適用 ─────────

  apply(effects: readonly Effect[] | undefined, ctx: EffectContext = {}): void {
    if (!effects) return;
    for (const effect of effects) {
      switch (effect.type) {
        case 'setFlag':
          this.set(effect.flag);
          break;
        case 'learn':
          this.learn(effect.topic, effect.stage, ctx);
          break;
        case 'setConsent':
          this.setConsent(effect.npc, effect.request, effect.status, effect.note, ctx);
          break;
        case 'recordPromise':
          this.recordPromise(effect.id, effect.from, effect.to, effect.content, ctx);
          break;
      }
    }
  }

  // ───────── 保存・復元 ─────────

  /** 立っているフラグの一覧（立った順）。 */
  flagList(): FlagId[] {
    return [...this.flags];
  }

  snapshot(): StorySnapshot {
    const npcIds = new Set([...this.met, ...this.consents.keys()]);
    return {
      clock: this.clock,
      flags: [...this.flags],
      learned: this.allLearned(),
      npcs: [...npcIds].map((id) => ({ id, met: this.met.has(id), consents: [...(this.consents.get(id) ?? [])] })),
      promises: [...this.promises],
    };
  }

  /**
   * 状態全体を置き換える。snapshot は検証済み（save/saveData.ts）であることを前提とする。
   * 引数なしで呼ぶと最初の状態に戻る。
   */
  restore(snapshot?: StorySnapshot): void {
    this.flags.clear();
    this.learned.clear();
    this.met.clear();
    this.consents.clear();
    this.promises.length = 0;
    this.clock = 0;
    if (snapshot) {
      snapshot.flags.forEach((f) => this.flags.add(f));
      for (const l of [...snapshot.learned].sort((a, b) => a.order - b.order)) {
        const list = this.learned.get(l.topic) ?? [];
        list.push(l);
        this.learned.set(l.topic, list);
      }
      for (const n of snapshot.npcs) {
        if (n.met) this.met.add(n.id);
        if (n.consents.length > 0) this.consents.set(n.id, [...n.consents].sort((a, b) => a.order - b.order));
      }
      this.promises.push(...[...snapshot.promises].sort((a, b) => a.order - b.order));
      this.clock = snapshot.clock;
    }
    this.events?.emit('storyRestored', {});
  }

  private tick(): number {
    return ++this.clock;
  }

  private requireNpc(npc: NpcId): void {
    if (!this.defs.npcs.includes(npc)) throw new Error(`未定義の住民 ${npc}`);
  }
}
