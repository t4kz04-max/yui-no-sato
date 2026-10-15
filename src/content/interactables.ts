import type { Collider } from '../core/collision';
import type { Interactable, NpcInteractable } from '../interaction/types';

/**
 * 村の中で話しかけたり調べたりできるもの（Phase 1 の仮配置）。
 * 位置は src/world/layout.ts の建物・小物の配置に合わせている。
 * 住民の立ち位置は道をふさがない場所を選び、tests/content.test.ts で検査している。
 */
export const INTERACTABLES: readonly Interactable[] = [
  // ── 住民 ──
  {
    kind: 'npc',
    id: 'toki',
    character: 'toki',
    label: 'トキ',
    dialogue: 'toki',
    location: 'southPlaza',
    // 橋を渡ってすぐの広場。橋の方を向いて主人公を待っている
    position: { x: -3, z: 18.5 },
    heading: 0.38,
    range: 2.6,
  },
  {
    kind: 'npc',
    id: 'sae',
    character: 'sae',
    label: 'サエ',
    dialogue: 'sae',
    location: 'saeHouse',
    position: { x: 3.4, z: 10.6 },
    heading: -0.4,
    range: 2.6,
  },
  {
    kind: 'npc',
    id: 'isuke',
    character: 'isuke',
    label: '伊助',
    dialogue: 'isuke',
    location: 'isukeHouse',
    // 家と畑の間。畑の方を気にしている
    position: { x: 33.5, z: 6.6 },
    heading: Math.PI / 2,
    range: 2.6,
  },
  {
    kind: 'npc',
    id: 'sohei',
    character: 'sohei',
    label: '宗平',
    dialogue: 'sohei',
    location: 'soheiWorkshop',
    position: { x: -2.5, z: -23.2 },
    heading: 0,
    range: 2.6,
  },
  {
    kind: 'npc',
    id: 'mine',
    character: 'mine',
    label: 'ミネ',
    dialogue: 'mine',
    location: 'mineHouse',
    position: { x: -15.2, z: -10 },
    heading: Math.PI / 2,
    range: 2.6,
  },

  // ── 調べられるもの ──
  {
    kind: 'object',
    id: 'saeRoof',
    label: 'サエ家の屋根',
    dialogue: 'saeRoof',
    location: 'saeHouse',
    position: { x: -4, z: 9.9 },
    // 屋根は見上げて調べる物なので、真下まで行かなくても、広場の西側から家へ近づけば調べられる（Phase 7・U02）
    range: 4.0,
    markerHeight: 2.6,
    // 調べている間は、広場から南面の傷んだ所（西寄り）を見上げる（Phase 6.5）
    view: { pos: { x: -3.2, z: 19, y: 2.5 }, look: { x: -4.2, y: 9.2, z: 3.5 } },
  },
  {
    kind: 'object',
    id: 'hasaRack',
    label: 'はさ掛け',
    dialogue: 'hasaRack',
    location: 'isukeHouse',
    position: { x: 38, z: 9.2 },
    range: 3.2,
    markerHeight: 2.6,
  },
  {
    kind: 'object',
    id: 'kayaBundles',
    label: '茅の束',
    dialogue: 'kayaBundles',
    location: 'mineHouse',
    position: { x: -20.5, z: 15.6 },
    range: 2.8,
    markerHeight: 1.9,
  },
  {
    kind: 'object',
    id: 'planTable',
    // 室内の作業台と紛らわしくないよう、段取りを考える台であることが分かる名前にする（Phase 7・15）
    label: '段取りの作業台',
    dialogue: 'planTable',
    opens: 'plan',
    location: 'soheiWorkshop',
    position: { x: 4.5, z: -20.1 },
    range: 2.6,
    markerHeight: 1.6,
  },
  {
    kind: 'object',
    id: 'ledger',
    label: '結帳',
    dialogue: 'ledger',
    location: 'saeHouse',
    // Phase 5.5：サエ家の室内、北の壁際の棚の文箱（world/saeInterior.ts の ledgerShelf）
    position: { x: 1.4, z: -4.55 },
    range: 2.0,
    markerHeight: 1.2,
    opens: 'ledger',
    indoor: true,
  },
  {
    kind: 'object',
    id: 'irori',
    label: '囲炉裏',
    dialogue: 'irori',
    location: 'saeHouse',
    // サエ家の室内、板の間の中央（world/saeInterior.ts の irori の南の縁）
    position: { x: -0.3, z: -0.4 },
    range: 1.8,
    markerHeight: 1.0,
    indoor: true,
  },
  // ── サエ家の入口（Phase 5.5）。外から E で入り、中から E で出る ──
  {
    kind: 'object',
    id: 'saeDoor',
    label: 'サエ家の入口',
    action: '入る',
    dialogue: 'saeDoor',
    location: 'saeHouse',
    position: { x: 0, z: 7.1 },
    range: 1.8,
    markerHeight: 2.4,
    opens: 'enterHouse',
  },
  {
    kind: 'object',
    id: 'saeDoorInside',
    label: '入口',
    action: '外に出る',
    dialogue: 'saeDoorInside',
    location: 'saeHouse',
    position: { x: 0, z: 5.2 },
    range: 1.8,
    markerHeight: 2.2,
    opens: 'leaveHouse',
    indoor: true,
  },
  {
    kind: 'object',
    id: 'mineRecords',
    label: 'ミネ家の控え',
    dialogue: 'mineRecords',
    location: 'mineHouse',
    // 茅置場の脇の棚（world/layout.ts の recordShelf）
    position: { x: -21.4, z: 8.5 },
    range: 2.4,
    markerHeight: 1.8,
  },
];

export const NPCS: readonly NpcInteractable[] = INTERACTABLES.filter((i): i is NpcInteractable => i.kind === 'npc');

/** 住民は通り抜けられない（当たり判定の半径）。 */
export const NPC_COLLIDER_RADIUS = 0.4;

/** 外にある対象（屋外の配置の確認に使う）。 */
export const OUTDOOR_INTERACTABLES: readonly Interactable[] = INTERACTABLES.filter((i) => !i.indoor);

export function npcColliders(npcs: readonly NpcInteractable[] = NPCS): Collider[] {
  return npcs.map((n) => ({ kind: 'circle', x: n.position.x, z: n.position.z, radius: NPC_COLLIDER_RADIUS }));
}
