import type { CharacterDef } from '../content/characters';
import type { StoryState } from '../story/StoryState';
import { CONSENT_LABEL, type PlanId, type TopicId } from '../story/types';
import { buildNotebook, type JournalSources, type NotebookPromise } from './models';
import { describePlan } from './planModels';

/**
 * 「選んだことの記録」（選択履歴）。決めた計画ごとに、何を選び、誰が承知し、その結果何が変わったかを並べる。
 * 計画を決めた後とエンディングで振り返れるようにする（DOM 非依存）。
 *
 * - すべて実際に起きたこと（決定の記録・返事の記録・手帳）から作る。知らなかった情報は出さない。
 * - 点数や良し悪しは出さない。「実現したこと」と「残ったこと」を並べる。
 */

export interface ResultSummary {
  readonly title: string;
  readonly achieved: readonly string[];
  readonly remains: readonly string[];
}

export interface HistorySources extends JournalSources {
  /** 結果の要約（計画 → 結果 ID → 実現したこと・残ったこと）。 */
  readonly result: (planId: PlanId, outcomeId: string, story: StoryState) => ResultSummary | null;
  /** 一行の要約（選ばなかった案に添える）。 */
  readonly tagline: (planId: PlanId, outcomeId: string) => string | undefined;
  /** 選んだ選択肢に関わる情報（項目 → 選択肢 → 情報）。 */
  readonly relevantTopics: Readonly<Record<PlanId, Readonly<Record<string, Readonly<Record<string, readonly TopicId[]>>>>>>;
  /** 計画の見出し（「第1幕 サエ家の屋根葺き」など）。 */
  readonly actLabel: Readonly<Record<PlanId, string>>;
}

export interface HistoryAct {
  readonly planId: PlanId;
  readonly label: string;
  /** 決めた案（項目と選んだもの）。 */
  readonly choices: ReadonlyArray<{ readonly item: string; readonly choice: string }>;
  readonly agreedBy: string;
  /** 決める前に断られた・条件を付けられた案（相談の経過）。 */
  readonly revisions: readonly string[];
  /** 決めたときに分かっていた、選んだ案に関わること（手帳より。決めた後に知ったことは含めない）。 */
  readonly knownAtDecision: readonly string[];
  readonly result: ResultSummary | null;
  /** 承諾を得ていたが選ばなかった案。 */
  readonly notChosen: readonly string[];
}

export interface HistoryModel {
  readonly acts: readonly HistoryAct[];
  readonly promises: readonly NotebookPromise[];
}

const PLAN_ORDER: readonly PlanId[] = ['roof', 'isukeRoof'];

export function buildHistory(story: StoryState, src: HistorySources): HistoryModel {
  const nameOf = (npc: string) => (src.characters[npc] as CharacterDef | undefined)?.name ?? npc;
  const acts: HistoryAct[] = [];
  for (const planId of PLAN_ORDER) {
    const decision = story.planDecision(planId);
    const planning = story.planDefs(planId);
    if (!decision || !planning) continue;
    const plan = decision.plan;
    const visibleItems = planning.items.filter((i) => !i.visibleWhen || i.visibleWhen(plan));
    const choices = visibleItems.map((i) => ({ item: i.label, choice: i.options.find((o) => o.id === plan[i.id])?.label ?? '?' }));
    const sig = story.planSignature(plan, planId);

    const revisions = story
      .planResponses(planId)
      .filter((r) => r.status !== 'agreed' && story.planSignature(r.plan, planId) !== sig)
      .map((r) => `${describePlan(story, r.plan, planId)} … ${nameOf(r.npc)}：${CONSENT_LABEL[r.status]}`);

    const topics = new Set<TopicId>();
    for (const i of visibleItems) for (const t of src.relevantTopics[planId]?.[i.id]?.[plan[i.id] ?? ''] ?? []) topics.add(t);
    const knownAtDecision = [...topics].flatMap((t) => {
      const def = story.defs.topics[t];
      const before = story.history(t).filter((h) => h.order < decision.order);
      const last = before[before.length - 1];
      if (!def || !last) return [];
      const stage = def.stages.find((s) => s.id === last.stage);
      const who = def.person ? `${nameOf(def.person)}｜` : '';
      return [`${who}${stage?.summary ?? def.title}`];
    });

    const notChosen = story
      .agreedPlans(planId)
      .filter((p) => story.planSignature(p, planId) !== sig)
      .map((p) => {
        const id = planning.outcome(p);
        const tagline = id ? src.tagline(planId, id) : undefined;
        return tagline ? `${tagline}（${describePlan(story, p, planId)}）` : describePlan(story, p, planId);
      });

    acts.push({
      planId,
      label: src.actLabel[planId] ?? planning.title,
      choices,
      agreedBy: planning.involved(plan).map(nameOf).join('・'),
      revisions,
      knownAtDecision,
      result: src.result(planId, decision.outcome, story),
      notChosen,
    });
  }
  return { acts, promises: buildNotebook(story, src).promises };
}
