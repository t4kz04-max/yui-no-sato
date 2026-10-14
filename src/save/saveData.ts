import type {
  ConsentEntry,
  ConsentStatus,
  LearnedStage,
  Chapter,
  NpcStateSnapshot,
  PlanDecision,
  PlanId,
  PlanningDefs,
  PlanResponse,
  PlanSnapshot,
  PlanSpec,
  PromiseRecord,
  StoryDefinitions,
  StorySnapshot,
} from '../story/types';
import { CHAPTERS } from '../story/types';

/**
 * 保存データの形式と検証。DOM・Three.js に依存しない（ブラウザの保存領域は SaveStore が扱う）。
 *
 * 読み込み時の方針：
 * - 構造が壊れている（JSON でない・型が違う・必須項目がない）→ 読み込まない（corrupt）。
 * - 新しい版の形式 → 読み込まない（unsupported）。
 * - 構造は正しいが、今の定義にない ID や順序の矛盾がある → その項目だけ除いて読み込み、警告を返す。
 */
export const SAVE_FORMAT = 'yui-no-yakusoku-save';
/**
 * 版 3：章と、章ごとの計画（第1幕・第3幕）。
 * 版 2（Phase 3 の計画）：探索の記録は残し、計画とその結果は取り除いて第1幕に戻す（docs/PHASE4_DESIGN.md §10）。
 * 版 1：計画なしとして読み込む。
 */
export const SAVE_VERSION = 3;

export interface PlayerSnapshot {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  readonly version: number;
  readonly savedAt: string;
  readonly player: PlayerSnapshot;
  readonly story: StorySnapshot;
}

export type ParseResult =
  | { readonly ok: true; readonly save: SaveFile; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: 'empty' | 'corrupt' | 'unsupported'; readonly detail: string };

export function createSave(story: StorySnapshot, player: PlayerSnapshot, now: Date = new Date()): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    player: { x: player.x, z: player.z, heading: player.heading },
    story,
  };
}

class CorruptError extends Error {}

const CONSENT_VALUES: readonly ConsentStatus[] = ['declined', 'conditional', 'agreed'];

export function parseSave(text: string | null, defs: StoryDefinitions): ParseResult {
  if (text === null || text === '') return { ok: false, reason: 'empty', detail: '保存データがありません' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'corrupt', detail: 'JSON として読めません' };
  }
  try {
    const root = obj(raw, '保存データ');
    if (root.format !== SAVE_FORMAT) throw new CorruptError('形式名が違います');
    if (typeof root.version !== 'number' || !Number.isInteger(root.version) || root.version < 1) {
      throw new CorruptError('版番号が不正です');
    }
    if (root.version > SAVE_VERSION) {
      return { ok: false, reason: 'unsupported', detail: `新しい版（${root.version}）の保存データです` };
    }
    const warnings: string[] = [];
    const savedAt = str(root.savedAt, 'savedAt');
    const p = obj(root.player, 'player');
    const player: PlayerSnapshot = { x: num(p.x, 'player.x'), z: num(p.z, 'player.z'), heading: num(p.heading, 'player.heading') };
    const story = parseStory(obj(root.story, 'story'), defs, warnings, root.version);
    return { ok: true, save: { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, player, story }, warnings };
  } catch (e) {
    if (e instanceof CorruptError) return { ok: false, reason: 'corrupt', detail: e.message };
    throw e;
  }
}

function parseStory(
  s: Record<string, unknown>,
  defs: StoryDefinitions,
  warnings: string[],
  version: number,
): StorySnapshot {
  let clock = int(s.clock, 'story.clock');

  const flags = [...new Set(arr(s.flags, 'story.flags').map((f, i) => str(f, `story.flags[${i}]`)))];

  // 情報：定義にないものは除き、トピックごとに段階が進む順になっているものだけを残す
  const learned: LearnedStage[] = [];
  const rawLearned = arr(s.learned, 'story.learned').map((v, i) => {
    const o = obj(v, `story.learned[${i}]`);
    return {
      topic: str(o.topic, 'topic'),
      stage: str(o.stage, 'stage'),
      order: int(o.order, 'order'),
      ...optSource(o.source),
    } satisfies LearnedStage;
  });
  const lastRank = new Map<string, number>();
  for (const l of [...rawLearned].sort((a, b) => a.order - b.order)) {
    const def = defs.topics[l.topic];
    const rank = def ? def.stages.findIndex((st) => st.id === l.stage) : -1;
    if (!def || rank < 0) {
      warnings.push(`定義にない情報を読み飛ばしました：${l.topic}/${l.stage}`);
      continue;
    }
    if (rank <= (lastRank.get(l.topic) ?? -1)) {
      warnings.push(`情報の段階の順序が矛盾しているため読み飛ばしました：${l.topic}/${l.stage}`);
      continue;
    }
    lastRank.set(l.topic, rank);
    learned.push(l);
  }

  const npcs: NpcStateSnapshot[] = [];
  for (const [i, v] of arr(s.npcs, 'story.npcs').entries()) {
    const o = obj(v, `story.npcs[${i}]`);
    const id = str(o.id, 'npcs.id');
    const met = bool(o.met, 'npcs.met');
    const consents: ConsentEntry[] = [];
    for (const [j, c] of arr(o.consents, 'npcs.consents').entries()) {
      const co = obj(c, `npcs.consents[${j}]`);
      const status = str(co.status, 'status') as ConsentStatus;
      if (!CONSENT_VALUES.includes(status)) throw new CorruptError(`意向の値が不正です：${status}`);
      const entry: ConsentEntry = {
        request: str(co.request, 'request'),
        status,
        order: int(co.order, 'order'),
        ...optNote(co.note),
        ...optSource(co.source),
      };
      if (!defs.requests[entry.request]) {
        warnings.push(`定義にない依頼を読み飛ばしました：${id}/${entry.request}`);
        continue;
      }
      consents.push(entry);
    }
    if (!defs.npcs.includes(id)) {
      warnings.push(`定義にない住民を読み飛ばしました：${id}`);
      continue;
    }
    if (npcs.some((n) => n.id === id)) {
      warnings.push(`住民の記録が重複していたため後のものを読み飛ばしました：${id}`);
      continue;
    }
    npcs.push({ id, met, consents });
  }

  const promises: PromiseRecord[] = [];
  for (const [i, v] of arr(s.promises, 'story.promises').entries()) {
    const o = obj(v, `story.promises[${i}]`);
    const p: PromiseRecord = {
      id: str(o.id, 'id'),
      from: str(o.from, 'from'),
      to: str(o.to, 'to'),
      content: str(o.content, 'content'),
      order: int(o.order, 'order'),
      ...optSource(o.source),
    };
    if (!defs.households.includes(p.from) || !defs.households.includes(p.to)) {
      warnings.push(`定義にない家の約束を読み飛ばしました：${p.id}`);
      continue;
    }
    if (promises.some((q) => q.id === p.id)) {
      warnings.push(`重複した約束を読み飛ばしました：${p.id}`);
      continue;
    }
    promises.push(p);
  }

  // 記録の順番が時計より進んでいたら時計を合わせる（以後の記録の順序を保つ）
  const maxOrder = Math.max(
    0,
    ...learned.map((l) => l.order),
    ...npcs.flatMap((n) => n.consents.map((c) => c.order)),
    ...promises.map((p) => p.order),
  );
  if (maxOrder > clock) {
    warnings.push('記録の順番を補正しました');
    clock = maxOrder;
  }
  // 章と計画
  let chapter: Chapter = 'ch1';
  let plans: Record<PlanId, PlanSnapshot> = {};
  let result = { flags, learned, npcs, promises };
  if (version >= 3) {
    const c = str(s.chapter, 'story.chapter');
    if (!CHAPTERS.includes(c as Chapter)) throw new CorruptError(`章が不正です：${c}`);
    chapter = c as Chapter;
    const rawPlans = obj(s.plans, 'story.plans');
    for (const [id, v] of Object.entries(rawPlans)) {
      const planning = defs.plans?.[id];
      if (!planning) {
        warnings.push(`定義にない計画を読み飛ばしました：${id}`);
        continue;
      }
      plans[id] = parsePlan(obj(v, `story.plans.${id}`), planning, defs, warnings);
    }
  } else if (version === 2) {
    // 版2（Phase 3 の計画）：項目が足りず今の規則で検証できないため、計画と、その結果として入った状態を取り除く
    const old = obj(s.plan, 'story.plan');
    if (old.decision !== null && old.decision !== undefined) {
      result = stripPhase3Outcome(result);
      warnings.push('以前の版で決めた屋根葺きの計画は、新しい仕組みで立て直す必要があります（計画の前に戻しました）');
    } else if (old.draft !== null || (Array.isArray(old.responses) && old.responses.length > 0)) {
      warnings.push('以前の版の作業台の案と返事は、新しい仕組みに合わないため破棄しました');
    }
    plans = {};
  }

  // 章と決定の整合（決めていないのに先の章にいる、などは部分的に直せないので破損として扱う）
  const roofDecided = !!plans.roof?.decision;
  const isukeDecided = !!plans.isukeRoof?.decision;
  const rank = CHAPTERS.indexOf(chapter);
  if (rank >= CHAPTERS.indexOf('roofDay') && defs.plans?.roof && !roofDecided) throw new CorruptError('屋根葺きを決めないまま先の章に進んでいます');
  if (roofDecided && rank < CHAPTERS.indexOf('roofDay')) throw new CorruptError('屋根葺きを決めたのに第1幕のままです');
  if (isukeDecided !== (chapter === 'end') && defs.plans?.isukeRoof) throw new CorruptError('第3幕の決定と章が食い違っています');

  const planOrders = Object.values(plans).flatMap((p) => [...p.responses.map((r) => r.order), p.decision?.order ?? 0]);
  if (Math.max(0, ...planOrders) > clock) {
    warnings.push('記録の順番を補正しました（計画）');
    clock = Math.max(0, ...planOrders);
  }
  return { clock, ...result, chapter, plans };
}

/** 版2 で決めた計画の結果として入った状態（屋根の葺き替え・約束・伊助の意向の変化・フラグ）を取り除く。 */
function stripPhase3Outcome<T extends { flags: string[]; learned: LearnedStage[]; npcs: NpcStateSnapshot[]; promises: PromiseRecord[] }>(
  r: T,
): T {
  return {
    ...r,
    flags: r.flags.filter((f) => f !== 'roofing:done'),
    learned: r.learned.filter((l) => !(l.topic === 'sae.roof' && (l.stage === 'worse' || l.stage === 'renewed'))),
    promises: r.promises.filter((p) => p.id !== 'saeHelpsIsukeHarvest'),
    npcs: r.npcs.map((n) =>
      n.id !== 'isuke'
        ? n
        : { ...n, consents: n.consents.filter((c) => !(c.request === 'roofPrep' || (c.request === 'roofDay' && c.status === 'agreed'))) },
    ),
  };
}

/**
 * 計画の検証。案・返事は今の定義と規則で検査し、合わないものは除いて警告する。
 * 決定の記録が規則と合わない（承諾していない人がいる等）ときは、結果の効果が状態に入っているため
 * 部分的に直せないので破損として扱う。
 */
function parsePlan(o: Record<string, unknown>, planning: PlanningDefs, defs: StoryDefinitions, warnings: string[]): PlanSnapshot {
  const specOf = (v: unknown, name: string): PlanSpec | null => {
    const raw = obj(v, name);
    const spec: Record<string, string> = {};
    for (const [k, val] of Object.entries(raw)) spec[k] = str(val, `${name}.${k}`);
    const valid =
      Object.keys(spec).length === planning.items.length && planning.items.every((i) => i.options.some((opt) => opt.id === spec[i.id]));
    if (!valid) return null;
    // 依存関係が整っていない案は、今の規則では作れない
    const normalized = planning.normalize ? planning.normalize(spec) : spec;
    return planning.items.every((i) => normalized[i.id] === spec[i.id]) ? spec : null;
  };
  const sig = (plan: PlanSpec) => planning.items.map((i) => `${i.id}=${plan[i.id]}`).join(';');

  let draft: PlanSpec | null = null;
  if (o.draft !== null) {
    draft = specOf(o.draft, 'plan.draft');
    if (!draft) warnings.push(`今の定義にない計画の案を読み飛ばしました（${planning.id}）`);
  }

  const responses: PlanResponse[] = [];
  for (const [i, v] of arr(o.responses, 'plan.responses').entries()) {
    const r = obj(v, `plan.responses[${i}]`);
    const npc = str(r.npc, 'npc');
    const status = str(r.status, 'status') as ConsentStatus;
    if (!CONSENT_VALUES.includes(status)) throw new CorruptError(`返事の値が不正です：${status}`);
    const reason = str(r.reason, 'reason');
    const order = int(r.order, 'order');
    const plan = specOf(r.plan, 'plan');
    const source = optSource(r.source);
    // 返事は今の規則と一致するものだけ残す（規則が変わった古い記録は、相談し直してもらう）
    const rule =
      plan && defs.npcs.includes(npc) && planning.invalidReason(plan) === null && planning.involved(plan).includes(npc)
        ? planning.respond(npc, plan)
        : null;
    if (!plan || !rule || rule.status !== status || rule.reason !== reason) {
      warnings.push(`規則と合わない計画への返事を読み飛ばしました：${npc}`);
      continue;
    }
    responses.push({ npc, plan, status, reason, order, ...source });
  }

  let decision: PlanDecision | null = null;
  if (o.decision !== null) {
    const d = obj(o.decision, 'plan.decision');
    const plan = specOf(d.plan, 'decision.plan');
    const outcome = str(d.outcome, 'decision.outcome');
    const order = int(d.order, 'decision.order');
    if (!plan || planning.outcome(plan) !== outcome) throw new CorruptError('決定した計画の記録が不正です');
    const agreed = planning
      .involved(plan)
      .every((npc) => responses.some((r) => r.npc === npc && sig(r.plan) === sig(plan) && r.status === 'agreed'));
    if (!agreed) throw new CorruptError('承諾していない住民を含む計画が決定されています');
    decision = { plan, outcome, order };
    if (!draft || sig(draft) !== sig(plan)) {
      warnings.push('決定した計画と今の案が食い違っていたため合わせました');
      draft = plan;
    }
  }
  return { draft, responses, decision };
}

// ───────── 型の検査 ─────────

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new CorruptError(`${name} がオブジェクトではありません`);
  return v as Record<string, unknown>;
}
function arr(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) throw new CorruptError(`${name} が配列ではありません`);
  return v;
}
function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new CorruptError(`${name} が文字列ではありません`);
  return v;
}
function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CorruptError(`${name} が数値ではありません`);
  return v;
}
function int(v: unknown, name: string): number {
  const n = num(v, name);
  if (!Number.isInteger(n) || n < 0) throw new CorruptError(`${name} が 0 以上の整数ではありません`);
  return n;
}
function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw new CorruptError(`${name} が真偽値ではありません`);
  return v;
}
/** 省略可能な入手元。存在すれば { source } を返す。 */
function optSource(v: unknown): { source?: string } {
  return v === undefined ? {} : { source: str(v, 'source') };
}
/** 省略可能な意向の注記。 */
function optNote(v: unknown): { note?: string } {
  return v === undefined ? {} : { note: str(v, 'note') };
}
