import type { CharacterDef } from '../content/characters';
import type { LedgerEntry } from '../content/ledger';
import { LEDGER_KIND_LABEL, SETTLEMENT_LABEL, type LedgerSettlement } from '../content/ledger';
import type { StoryState } from '../story/StoryState';
import { CONSENT_LABEL, type ConsentStatus, type HouseholdId, type NpcId, type TopicCategory, type TopicId } from '../story/types';

/**
 * 手帳・結帳の表示内容を、ゲーム状態と定義から組み立てる（DOM 非依存。UI はこの結果を描くだけ）。
 */

export interface TopicHistoryItem {
  readonly text: string;
  readonly category: TopicCategory;
  readonly source?: string;
}

export interface NotebookTopic {
  readonly topic: TopicId;
  readonly title: string;
  readonly personName?: string;
  readonly category: TopicCategory;
  readonly text: string;
  readonly source?: string;
  /** 最後に更新された順番（新しい印の判定に使う）。 */
  readonly order: number;
  /** 以前の段階（古い順）。情報が更新されても消さず、経緯として確認できる。 */
  readonly history: readonly TopicHistoryItem[];
}

export interface NotebookConsent {
  readonly request: string;
  readonly statusKey: ConsentStatus;
  readonly status: string;
  readonly note?: string;
  /** 以前の意向（古い順。例：「断っている → 条件付き」）。 */
  readonly history: readonly string[];
}

export interface NotebookPerson {
  readonly id: NpcId;
  readonly name: string;
  readonly role: string;
  /** 今の計画案への返事（相談が必要な人だけ）。 */
  readonly plan?: { readonly status: string; readonly summary?: string };
  readonly consents: readonly NotebookConsent[];
  readonly topics: readonly NotebookTopic[];
}

export interface NotebookPromise {
  readonly content: string;
  readonly from: string;
  readonly to: string;
  readonly source?: string;
}

export interface NotebookModel {
  readonly people: readonly NotebookPerson[];
  readonly known: readonly NotebookTopic[];
  readonly unconfirmed: readonly NotebookTopic[];
  readonly promises: readonly NotebookPromise[];
  /** 手帳の中で最も新しい記録の順番。 */
  readonly latestOrder: number;
}

export interface JournalSources {
  readonly characters: Readonly<Record<string, CharacterDef>>;
  /** 計画への返事の要旨（理由 ID → 文）。 */
  readonly planSummaries?: Readonly<Record<string, string>>;
  readonly households: Readonly<Record<HouseholdId, { readonly name: string; readonly person?: string }>>;
}

export function buildTopic(story: StoryState, topic: TopicId, src: JournalSources): NotebookTopic | null {
  const def = story.defs.topics[topic];
  const history = story.history(topic);
  const last = history[history.length - 1];
  if (!def || !last) return null;
  const stageDef = (id: string) => def.stages.find((s) => s.id === id)!;
  const current = stageDef(last.stage);
  return {
    topic,
    title: def.title,
    ...(def.person ? { personName: src.characters[def.person]?.name ?? def.person } : {}),
    category: current.category,
    text: current.text,
    ...(last.source ? { source: last.source } : {}),
    order: last.order,
    history: history.slice(0, -1).map((h) => ({
      text: stageDef(h.stage).text,
      category: stageDef(h.stage).category,
      ...(h.source ? { source: h.source } : {}),
    })),
  };
}

function consentsOf(story: StoryState, npc: NpcId): NotebookConsent[] {
  const list = story.consentHistory(npc);
  const requests = [...new Set(list.map((c) => c.request))];
  return requests.map((request) => {
    const entries = list.filter((c) => c.request === request);
    const current = entries[entries.length - 1]!;
    return {
      request: story.defs.requests[request]?.label ?? request,
      statusKey: current.status,
      status: CONSENT_LABEL[current.status],
      ...(current.note ? { note: current.note } : {}),
      history: entries.slice(0, -1).map((c) => CONSENT_LABEL[c.status] + (c.note ? `（${c.note}）` : '')),
    };
  });
}

export function buildNotebook(story: StoryState, src: JournalSources): NotebookModel {
  const topics = Object.keys(story.defs.topics)
    .map((id) => buildTopic(story, id, src))
    .filter((t): t is NotebookTopic => t !== null)
    .sort((a, b) => b.order - a.order);

  const people: NotebookPerson[] = story.defs.npcs
    .filter((id) => story.hasMet(id))
    .map((id) => {
      const c = src.characters[id];
      const involved = story.planInvolved().includes(id) && story.planPhase() !== 'decided';
      const response = involved ? story.planResponse(id) : undefined;
      const summary = response ? src.planSummaries?.[response.reason] : undefined;
      return {
        id,
        ...(involved
          ? { plan: { status: response ? CONSENT_LABEL[response.status] : 'まだ相談していない', ...(summary ? { summary } : {}) } }
          : {}),
        name: c?.name ?? id,
        role: c?.role ?? '',
        consents: consentsOf(story, id),
        topics: topics.filter((t) => story.defs.topics[t.topic]?.person === id),
      };
    });

  const promises = story.allPromises().map((p) => ({
    content: p.content,
    from: src.households[p.from]?.name ?? p.from,
    to: src.households[p.to]?.name ?? p.to,
    ...(p.source ? { source: p.source } : {}),
  }));

  const latestOrder = Math.max(
    0,
    ...topics.map((t) => t.order),
    ...story.defs.npcs.flatMap((n) => story.consentHistory(n).map((c) => c.order)),
    ...story.allPromises().map((p) => p.order),
  );

  return {
    people,
    known: topics.filter((t) => t.category === 'known'),
    unconfirmed: topics.filter((t) => t.category === 'unconfirmed'),
    promises,
    latestOrder,
  };
}

// ───────── 結帳 ─────────

export interface LedgerItemView {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly detail: string;
  readonly settlement: LedgerSettlement;
  readonly settlementLabel: string;
  readonly settlementNote: string;
  /** 関係する住民の現在の意向（手帳より）。過去の記録とは別に表示する。 */
  readonly currentStance: readonly string[];
}

export interface LedgerEntryView {
  readonly id: string;
  readonly when: string;
  readonly title: string;
  readonly items: readonly LedgerItemView[];
  /** 関連して今わかっていること（手帳より）。知らない情報は出さない。 */
  readonly related: readonly { readonly title: string; readonly text: string }[];
}

export interface LedgerModel {
  readonly entries: readonly LedgerEntryView[];
  readonly promises: readonly NotebookPromise[];
}

export function buildLedger(story: StoryState, ledger: readonly LedgerEntry[], src: JournalSources): LedgerModel {
  const name = (h: HouseholdId) => src.households[h]?.name ?? h;
  const stanceOf = (h: HouseholdId): string[] => {
    const person = src.households[h]?.person;
    if (!person) return [];
    const who = src.characters[person]?.name ?? person;
    return consentsOf(story, person).map(
      (c) => `${who}：${c.request}は「${c.status}」${c.note ? `（${c.note}）` : ''}`,
    );
  };
  const entries = ledger.map((e) => ({
    id: e.id,
    when: e.when,
    title: e.title,
    items: e.items.map((i) => ({
      id: i.id,
      from: name(i.from),
      to: name(i.to),
      kind: LEDGER_KIND_LABEL[i.kind],
      detail: i.detail,
      settlement: i.settlement,
      settlementLabel: SETTLEMENT_LABEL[i.settlement],
      settlementNote: i.settlementNote,
      currentStance: stanceOf(i.from),
    })),
    related: e.relatedTopics
      .map((t) => buildTopic(story, t, src))
      .filter((t): t is NotebookTopic => t !== null)
      .map((t) => ({ title: t.title, text: t.text })),
  }));
  return { entries, promises: buildNotebook(story, src).promises };
}
