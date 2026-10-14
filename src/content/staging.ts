import type { Collider } from '../core/collision';
import type { Vec2 } from '../core/math';
import type { PoseStyle } from '../characters/poses';
import type { RoofState } from '../world/builders/thatch';
import type { Chapter } from '../story/types';
import type { CharacterId } from './characters';
import { OUTCOMES, parseOutcomeId } from './plan';

/**
 * 見た目の演出を、物語の状態から決める（docs/PHASE5_ART.md §4）。
 * すべて純粋関数で、3D には依存しない。描画側（Game・RoofDayScene）はこの結果を表示するだけ。
 *
 * 屋根葺きの日の人と物は、Phase 4 の計画の結果（OUTCOMES[id]）だけから決める：
 * - 名前のある住民は、結果の placements にいる人だけが作業の場にいる（参加していない人は出さない）。
 * - 人手の多さ・屋根の上の人数・足場の範囲・茅の山は、結果の会話・結帳と合わせる
 *   （予定日・伊助なし＝「人手は少ない」、ミネの茅＝南面すべて、手持ち＝傷んだ所だけ）。
 */

// ───────── 屋根の状態 ─────────

export interface RoofStates {
  readonly sae: RoofState;
  readonly isuke: RoofState;
}

/**
 * 章と決定から、サエ家・伊助家の屋根の見た目を決める。
 * - サエ家：屋根葺きの日までは傷んだまま（当日は作業中）。三年後は、ミネの茅なら南面すべて、手持ちなら傷んだ所だけ新しい。
 * - 伊助家：三年後は傷んでいる。第3幕で葺いた結末（E1・E2）なら南面が新しい。見送った結末（E3）は傷んだまま。
 */
export function roofStates(chapter: Chapter, roofOutcome: string | undefined, isukeOutcome: string | undefined): RoofStates {
  const later = chapter === 'ch3' || chapter === 'end';
  const act1 = roofOutcome ? parseOutcomeId(roofOutcome) : null;
  const sae: RoofState = later && act1 ? (act1.full ? 'renewed' : 'partial') : 'old';
  const isuke: RoofState =
    chapter === 'ch3' ? 'worn' : chapter === 'end' ? (isukeOutcome && isukeOutcome !== 'e3' ? 'renewed' : 'worn') : 'old';
  return { sae, isuke };
}

// ───────── 住民の立ち姿 ─────────

/** 普段の立ち姿（characters.ts の idle）を、章と当日の役割で変える。 */
export function npcStyle(
  character: CharacterId,
  base: PoseStyle,
  chapter: Chapter,
  roofOutcome: string | undefined,
): PoseStyle {
  // 第3幕以降のサエは、夏に痛めた足のため杖をつく（🔶 暫定設定。強調しすぎない）
  if (character === 'sae' && (chapter === 'ch3' || chapter === 'end')) return 'cane';
  if (chapter === 'roofDay' && roofOutcome) {
    const role = roofDayStage(roofOutcome)?.roles[character];
    if (role) return role;
  }
  return base;
}

// ───────── 屋根葺きの日 ─────────

export type CrewRole = 'roof' | 'pass' | 'sort' | 'carry';

export interface CrewMember {
  readonly id: string;
  readonly role: CrewRole;
  /** VILLAGER_LOOKS の何番目の見た目か。 */
  readonly look: number;
  /** 地上の立ち位置（roof 以外）。carry は往復の端（茅の山の側）。 */
  readonly position: Vec2;
  readonly heading: number;
  /** carry：往復のもう一方の端（梯子の下）。 */
  readonly to?: Vec2;
  /** roof：サエ家の南面の上の位置（u：軒先 0〜棟 1、v：棟方向 西 0〜東 1）。 */
  readonly roofSpot?: { readonly u: number; readonly v: number };
}

export interface RoofDayStage {
  readonly outcome: string;
  /** 足場の範囲：full＝南面いっぱい、part＝傷んだ所だけ。 */
  readonly extent: 'full' | 'part';
  /** ミネから借りた新しい茅の山（東側）があるか。 */
  readonly mineKaya: boolean;
  /** 名前のある住民の当日の役割（placements にいる人だけ）。 */
  readonly roles: Readonly<Partial<Record<CharacterId, PoseStyle>>>;
  readonly crew: readonly CrewMember[];
  /** 梯子の足元（地上）。 */
  readonly ladders: readonly Vec2[];
  /** 茅の山（中心と半分の大きさ）。 */
  readonly piles: readonly RoofDayPile[];
}

export interface RoofDayPile {
  readonly id: 'own' | 'mine';
  readonly position: Vec2;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly size: 'large' | 'small';
  readonly fresh: boolean;
}

/** 当日の物の置き場所（サエ家の南、作業の場）。道・調べられる物・住民の立ち位置を避けている（tests/phase5.test.ts）。 */
export const ROOF_DAY_SPOTS = {
  ownPile: { x: -8.2, z: 9.5 },
  minePile: { x: 8.4, z: 8.75 },
  ladderWest: { x: -5.6, z: 8.35 },
  ladderEast: { x: 3.2, z: 8.35 },
} as const;

const NORTH = Math.PI;

/** 計画の結果から、屋根葺きの日の様子を決める。結果が分からなければ null。 */
export function roofDayStage(outcomeId: string): RoofDayStage | null {
  const def = OUTCOMES[outcomeId];
  const o = parseOutcomeId(outcomeId);
  if (!def || !o) return null;
  const full = o.full;
  const fewHands = o.family === 'solo';

  const roles: Partial<Record<CharacterId, PoseStyle>> = {};
  for (const who of Object.keys(def.placements) as CharacterId[]) {
    roles[who] = who === 'sohei' ? 'direct' : who === 'isuke' ? 'carry' : who === 'mine' ? 'holdKaya' : 'calm';
  }

  const crew: CrewMember[] = [];
  let look = 0;
  const add = (m: Omit<CrewMember, 'look' | 'id'>) => crew.push({ ...m, id: `crew${crew.length + 1}`, look: look++ });

  // 屋根の上（人数：人手の少ない計画は 1 人、ほかは 2 人。南面すべてを葺くなら 1 人増える）
  const roofSpots = [
    { u: 0.16, v: 0.25 },
    { u: 0.4, v: 0.36 },
    { u: 0.3, v: 0.7 },
  ];
  const onRoof = (fewHands ? 1 : 2) + (full ? 1 : 0);
  for (const spot of roofSpots.slice(0, onRoof)) add({ role: 'roof', position: { x: 0, z: 0 }, heading: NORTH, roofSpot: spot });
  // 地上：梯子の下で受け渡す人、茅の山から運ぶ人
  add({ role: 'pass', position: { x: -6.4, z: 9.2 }, heading: NORTH - 0.5 });
  add({ role: 'carry', position: { x: -7.1, z: 11.0 }, to: { x: -5.85, z: 10.1 }, heading: 0 });
  if (!fewHands) add({ role: 'sort', position: { x: -8.4, z: 8.1 }, heading: 0 });
  if (full) add({ role: 'carry', position: { x: 6.9, z: 10.1 }, to: { x: 4.0, z: 9.4 }, heading: -Math.PI / 2 });

  const piles: RoofDayPile[] = [
    { id: 'own', position: ROOF_DAY_SPOTS.ownPile, halfWidth: 1.2, halfDepth: 0.85, size: 'small', fresh: false },
  ];
  if (full) piles.push({ id: 'mine', position: ROOF_DAY_SPOTS.minePile, halfWidth: 1.3, halfDepth: 0.85, size: 'large', fresh: true });

  return {
    outcome: outcomeId,
    extent: full ? 'full' : 'part',
    mineKaya: full,
    roles,
    crew,
    ladders: full ? [ROOF_DAY_SPOTS.ladderWest, ROOF_DAY_SPOTS.ladderEast] : [ROOF_DAY_SPOTS.ladderWest],
    piles,
  };
}

/** 当日の地上の静止した人（受け渡し・束そろえ）の立ち位置。当たり判定と配置の確認に使う。 */
export function staticCrew(stage: RoofDayStage): CrewMember[] {
  return stage.crew.filter((c) => c.role === 'pass' || c.role === 'sort');
}

/** 人の当たり判定の半径（住民と同じ）。 */
export const CREW_RADIUS = 0.4;
export const LADDER_RADIUS = 0.35;

/** 当日に置く物と、地上で動かない人の当たり判定（茅を運ぶ人は動くので含めない）。 */
export function roofDayColliders(stage: RoofDayStage): Collider[] {
  return [
    ...stage.piles.map((p) => ({
      kind: 'box' as const,
      x: p.position.x,
      z: p.position.z,
      halfWidth: p.halfWidth,
      halfDepth: p.halfDepth,
      rotation: 0,
    })),
    ...stage.ladders.map((l) => ({ kind: 'circle' as const, x: l.x, z: l.z, radius: LADDER_RADIUS })),
    ...staticCrew(stage).map((c) => ({ kind: 'circle' as const, x: c.position.x, z: c.position.z, radius: CREW_RADIUS })),
  ];
}

// ───────── 屋根葺きの日の演出（Phase 6） ─────────

/** 当日の作業の進み方：朝の時点の進み具合と、その日のうちに届く上限（南面の下から上へ葺き進む）。 */
export interface RoofDayWork {
  /** 着いた時点の進み具合（0〜1）。 */
  readonly start: number;
  /** その日のうちに届く進み具合（人手の少ない計画は二日がかりなので途中まで）。 */
  readonly max: number;
  /** 上限に届くまでの時間（秒。プレイヤーが村を見て回る時間に合わせた目安）。 */
  readonly seconds: number;
}

export function roofDayWork(outcomeId: string): RoofDayWork | null {
  const o = parseOutcomeId(outcomeId);
  if (!o) return null;
  // 人手の少ない計画（伊助なし）は「今日のうちには終わらない」。前日の準備が済んでいれば早く進む
  if (o.family === 'solo') return { start: 0.1, max: 0.45, seconds: 180 };
  if (o.family === 'prep') return { start: 0.3, max: 0.95, seconds: 150 };
  return { start: 0.2, max: 0.9, seconds: 160 };
}

/** 着いてからの時間に応じた進み具合（0〜1）。 */
export function roofDayProgress(work: RoofDayWork, elapsed: number): number {
  const t = Math.max(0, Math.min(1, elapsed / work.seconds));
  return work.start + (work.max - work.start) * t;
}

/** 屋根葺きの日に着いたときに出す、短い要約（誰が来ているか・茅・足場）。すべて結果の定義から作る。 */
export interface RoofDayArrival {
  readonly when: string;
  readonly lines: readonly string[];
}

const NAME: Readonly<Record<string, string>> = { sohei: '宗平さん', isuke: '伊助さん', mine: 'ミネさん' };

export function roofDayArrival(outcomeId: string): RoofDayArrival | null {
  const def = OUTCOMES[outcomeId];
  const stage = roofDayStage(outcomeId);
  const o = parseOutcomeId(outcomeId);
  if (!def || !stage || !o) return null;
  const named = (['sohei', 'isuke', 'mine'] as const).filter((c) => c in def.placements).map((c) => NAME[c]);
  const lines: string[] = [];
  lines.push(`サエ家の前に集まったのは、${[...named, '村の人たち'].join('、')}。`);
  if (o.family === 'solo') lines.push('人手は少ない。今日のうちには終わらないだろう。');
  if (o.family === 'prep') lines.push('前の日に、伊助さんが茅を運び、足場を組んでくれていた。');
  if (o.family === 'wait') lines.push('待つあいだに、屋根の傷みは広がっていた。');
  if (o.family === 'waitHelp') lines.push('先に伊助家の刈り入れを済ませ、皆がそろう日を待った。');
  lines.push(stage.mineKaya ? 'ミネさんの茅が、家の東に積まれている。足場は南面いっぱいに組まれた。' : '茅はサエ家の手持ちの分だけ。足場は傷んだ所にだけ組まれた。');
  return { when: def.when, lines };
}

/**
 * 当日、近くを通ったときの住民・村の人のひと言（作業の様子と、計画の結果で変わる事情）。
 * キー：人物 ID（名前のある住民）または `crew:役割`（名前のない村の人）。作業の場にいない人のひと言は、いつもの場所で聞ける。
 */
export function roofDayBarks(outcomeId: string): Readonly<Record<string, readonly string[]>> {
  const o = parseOutcomeId(outcomeId);
  const def = OUTCOMES[outcomeId];
  if (!o || !def) return {};
  const barks: Record<string, string[]> = {};
  const onSite = (c: string) => c in def.placements;
  barks.sohei = [
    o.family === 'solo'
      ? '人手が足りん。今日は下の段までだな'
      : o.family === 'prep'
        ? '足場ができとるから、段取りが早い'
        : o.family === 'wait'
          ? '待った分、傷みが広がっとる。手間だな'
          : '皆そろったな。今日のうちに片づけるぞ',
  ];
  if (onSite('isuke')) {
    barks.isuke = [o.family === 'waitHelp' ? 'サエさんちが手伝ってくれて、刈り入れが早く済んだ' : '刈り入れは済んだ。今日はこっちだ'];
  } else {
    barks.isuke = [o.family === 'prep' ? '昨日の足場、役に立っとるか。こっちは稲刈りだ' : '屋根葺きは今日か。……こっちも手が離せん'];
  }
  if (onSite('mine')) barks.mine = ['この茅は、来年の秋に茅で返してもらう約束だよ'];
  barks['crew:roof'] = [o.full ? '新しい茅は、手ざわりが違うな' : '茅が足りん。傷んだ所だけだ', 'もう少し上だ、叩いて締めろ'];
  barks['crew:carry'] = ['もう一束、運ぶぞ'];
  barks['crew:pass'] = ['ほい、受け取った'];
  barks['crew:sort'] = ['束をそろえておくよ'];
  return barks;
}
