import type { EventSink } from '../core/EventBus';
import type { Effect, StoryQuery } from './conditions';
import type {
  ConsentEntry,
  ConsentStatus,
  FlagId,
  HouseholdId,
  LearnedStage,
  NpcId,
  PlanDecision,
  PlanPhase,
  PlanResponse,
  PlanSpec,
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
  /** 作業台で案が変わった。 */
  planDrafted: { readonly plan: PlanSpec };
  /** 住民が今の案に返事をした。 */
  planResponded: { readonly npc: NpcId; readonly status: ConsentStatus; readonly reason: string };
  planDecided: { readonly outcome: string };
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
  private draft: PlanSpec | null = null;
  private readonly responses: PlanResponse[] = [];
  private decision: PlanDecision | null = null;

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

  // ───────── 計画（Phase 3） ─────────

  /** 案の識別子（項目の順に並べた文字列）。同じ内容の案は同じ識別子になる。 */
  planSignature(plan: PlanSpec): string {
    const items = this.defs.planning?.items ?? [];
    return items.map((i) => `${i.id}=${plan[i.id] ?? ''}`).join(';');
  }

  planDraft(): PlanSpec | null {
    return this.draft;
  }

  planDecision(): PlanDecision | null {
    return this.decision;
  }

  outcome(): string | undefined {
    return this.decision?.outcome;
  }

  /** すべての返事（古い順）。案を変える前の返事も履歴として残る。 */
  planResponses(): readonly PlanResponse[] {
    return this.responses;
  }

  /** 案を作る・変える。決定後は変えられない。選択肢 ID は定義にあるものだけ受け付ける。 */
  setPlanDraft(plan: PlanSpec): boolean {
    const planning = this.requirePlanning();
    if (this.decision) return false;
    for (const item of planning.items) {
      const opt = plan[item.id];
      if (!item.options.some((o) => o.id === opt)) throw new Error(`計画の項目 ${item.id} に選択肢 ${opt} はありません`);
    }
    const normalized: PlanSpec = Object.fromEntries(planning.items.map((i) => [i.id, plan[i.id]!]));
    if (this.draft && this.planSignature(this.draft) === this.planSignature(normalized)) return false;
    this.draft = normalized;
    this.tick();
    this.events?.emit('planDrafted', { plan: normalized });
    return true;
  }

  /** 今の案に返事が必要な住民（案が成り立たないときは空）。 */
  planInvolved(): NpcId[] {
    const planning = this.defs.planning;
    if (!planning || !this.draft || planning.invalidReason(this.draft) !== null) return [];
    return planning.involved(this.draft);
  }

  /** 案（省略時は今の案）に対するこの住民の返事。 */
  planResponse(npc: NpcId, plan: PlanSpec | null = this.draft): PlanResponse | undefined {
    if (!plan) return undefined;
    const sig = this.planSignature(plan);
    for (let i = this.responses.length - 1; i >= 0; i--) {
      const r = this.responses[i]!;
      if (r.npc === npc && this.planSignature(r.plan) === sig) return r;
    }
    return undefined;
  }

  isPlanPending(npc: NpcId): boolean {
    return !this.decision && this.planInvolved().includes(npc) && !this.planResponse(npc);
  }

  planReason(npc: NpcId): string | undefined {
    return this.planResponse(npc)?.reason;
  }

  planPhase(): PlanPhase {
    if (this.decision) return 'decided';
    if (!this.draft) return 'none';
    if (this.defs.planning?.invalidReason(this.draft) !== null) return 'revise';
    const involved = this.planInvolved();
    const answers = involved.map((n) => this.planResponse(n));
    if (answers.some((a) => a && a.status !== 'agreed')) return 'revise';
    if (answers.some((a) => !a)) return 'pending';
    return 'ready';
  }

  /**
   * 今の案を住民に相談し、返事を記録する。返事は規則（今の事情と提案内容）だけで決まり、
   * 同じ案にすでに返事があればそれを返す（相談し直しても変わらない）。
   */
  consultPlan(npc: NpcId, ctx: EffectContext = {}): PlanResponse | null {
    const planning = this.requirePlanning();
    if (this.decision || !this.draft || !this.planInvolved().includes(npc)) return null;
    const existing = this.planResponse(npc);
    if (existing) return existing;
    const rule = planning.respond(npc, this.draft);
    const response: PlanResponse = {
      npc,
      plan: this.draft,
      status: rule.status,
      reason: rule.reason,
      order: this.tick(),
      ...(ctx.source ? { source: ctx.source } : {}),
    };
    this.responses.push(response);
    this.events?.emit('planResponded', { npc, status: rule.status, reason: rule.reason });
    return response;
  }

  /** 関係者全員が今の案を承諾していれば決定し、結果の効果を適用する。決定できなければ null。 */
  decidePlan(ctx: EffectContext = {}): string | null {
    const planning = this.requirePlanning();
    if (this.planPhase() !== 'ready' || !this.draft) return null;
    const outcome = planning.outcome(this.draft);
    if (!outcome) return null;
    this.decision = { plan: this.draft, outcome, order: this.tick() };
    this.apply(planning.outcomeEffects(outcome), ctx);
    this.events?.emit('planDecided', { outcome });
    return outcome;
  }

  private requirePlanning() {
    const planning = this.defs.planning;
    if (!planning) throw new Error('計画の定義がありません');
    return planning;
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
        case 'consultPlan':
          this.consultPlan(effect.npc, ctx);
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
      plan: { draft: this.draft, responses: [...this.responses], decision: this.decision },
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
    this.draft = null;
    this.responses.length = 0;
    this.decision = null;
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
      this.draft = snapshot.plan.draft;
      this.responses.push(...[...snapshot.plan.responses].sort((a, b) => a.order - b.order));
      this.decision = snapshot.plan.decision;
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
