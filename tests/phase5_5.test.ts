import { describe, expect, it } from 'vitest';
import { overlapsAny } from '../src/core/collision';
import { DEFAULT_PLAYER_TUNING, createPlayerState, updatePlayer, type WalkableWorld } from '../src/player/PlayerController';
import { buildCollisionMap, BRIDGE_RAIL_X } from '../src/world/collisionMap';
import { BRIDGE, BUILDINGS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, WATERWAY } from '../src/world/layout';
import { SAE_FLOOR_Y, groundHeight } from '../src/world/terrain';
import { SAE_INTERIOR, isInsideSaeHouse, saeInteriorColliders } from '../src/world/saeInterior';
import { INTERACTABLES, OUTDOOR_INTERACTABLES, npcColliders } from '../src/content/interactables';
import { DIALOGUES } from '../src/content/dialogues';
import { SAE_HOUSE_OPEN } from '../src/content/house';
import { currentObjective } from '../src/content/objectives';
import { STORY_DEFS } from '../src/content/story';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { StoryState } from '../src/story/StoryState';
import { evaluate } from '../src/story/conditions';
import { createSave, parseSave } from '../src/save/saveData';
import { plainText } from '../src/dialogue/markup';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 5.5（docs/PHASE5_5_PLAN.md）：橋の欄干の当たり判定、サエ家の室内と出入り、結帳の移設。
 */

const outdoor = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
const R = DEFAULT_PLAYER_TUNING.radius;
const walkWorld = (colliders = outdoor, bounds = WALK_BOUNDS): WalkableWorld => ({ colliders, bounds, groundHeight });

/** start から yaw の向き（0＝+Z、π/2＝+X）へ seconds 秒歩かせた後の位置。 */
function walk(start: { x: number; z: number }, yaw: number, seconds: number, world = walkWorld()) {
  const s = createPlayerState(start, yaw, world);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) updatePlayer(s, { forward: 1, right: 0, run: false }, yaw, dt, world);
  return s;
}

// ───────── 橋の欄干 ─────────

describe('橋の欄干の当たり判定', () => {
  const railInner = BRIDGE_RAIL_X - 0.1;
  const zs = {
    入口側の端: BRIDGE.startZ + 0.35,
    中央: (BRIDGE.startZ + BRIDGE.endZ) / 2,
    出口側の端: BRIDGE.endZ - 0.35,
    地面と接する所: BRIDGE.startZ + 0.05,
    地面と接する所_出口: BRIDGE.endZ - 0.05,
  };

  for (const side of [1, -1] as const) {
    const name = side > 0 ? '東（右）' : '西（左）';
    for (const [where, z] of Object.entries(zs)) {
      it(`${name}の柵の${where}：橋の上から横へ歩いても、柵を越えられない`, () => {
        const s = walk({ x: BRIDGE.x, z }, (side * Math.PI) / 2, 3);
        // 柵の線（欄干の内側の面）を越えて外へ出ない。柵の途中では内側の面の手前で止まる
        expect(Math.abs(s.x - BRIDGE.x)).toBeLessThan(BRIDGE_RAIL_X - R + 0.05);
        if (z > BRIDGE.startZ + 0.3 && z < BRIDGE.endZ - 0.3) expect(Math.abs(s.x - BRIDGE.x)).toBeLessThan(railInner - R + 0.02);
      });
    }
    it(`${name}の柵：橋の外（岸）から橋へ横から入れない`, () => {
      for (const z of [BRIDGE.startZ + 0.3, BRIDGE.endZ - 0.3]) {
        const start = { x: BRIDGE.x + side * (BRIDGE_RAIL_X + 0.9), z };
        expect(overlapsAny(start, R, outdoor)).toBe(false);
        const s = walk(start, (-side * Math.PI) / 2, 3);
        expect(Math.abs(s.x - BRIDGE.x)).toBeGreaterThan(BRIDGE_RAIL_X + 0.1 + R - 0.02);
      }
    });
  }

  it('橋の正規の入口から出口まで、まっすぐ渡れる（北へも南へも）', () => {
    const north = walk({ x: BRIDGE.x, z: BRIDGE.endZ + 3 }, Math.PI, 6);
    expect(north.z).toBeLessThan(BRIDGE.startZ - 2);
    const south = walk({ x: BRIDGE.x, z: BRIDGE.startZ - 3 }, 0, 6);
    expect(south.z).toBeGreaterThan(BRIDGE.endZ + 2);
  });

  it('橋の通路の端寄りを歩いても引っかからない（通路の幅を狭めすぎない）', () => {
    for (const x of [-0.95, 0.95]) {
      const s = walk({ x: BRIDGE.x + x, z: BRIDGE.startZ - 3 }, 0, 6);
      expect(s.z, `x=${x}`).toBeGreaterThan(BRIDGE.endZ + 2);
    }
  });

  it('水路は、橋以外では今までどおり渡れない', () => {
    expect(overlapsAny({ x: 10, z: WATERWAY.centerZ }, R, outdoor)).toBe(true);
    expect(overlapsAny({ x: BRIDGE.x, z: WATERWAY.centerZ }, R, outdoor)).toBe(false);
  });
});

// ───────── サエ家の室内 ─────────

describe('サエ家の室内', () => {
  const inside = saeInteriorColliders();
  const b = SAE_INTERIOR.bounds;
  const bounds = { minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1 };
  const map = buildReachability(inside, bounds, SAE_INTERIOR.entry, R);

  it('入ったときの位置は室内で、障害物と重ならない。出たときの位置は屋外で、障害物と重ならない', () => {
    expect(isInsideSaeHouse(SAE_INTERIOR.entry.x, SAE_INTERIOR.entry.z)).toBe(true);
    expect(overlapsAny(SAE_INTERIOR.entry, R, inside)).toBe(false);
    expect(isInsideSaeHouse(SAE_INTERIOR.exit.x, SAE_INTERIOR.exit.z)).toBe(false);
    expect(overlapsAny(SAE_INTERIOR.exit, R, [...outdoor, ...npcColliders()])).toBe(false);
  });

  it('室内の床は平らで、外の地形より一段高い（土台の上）', () => {
    for (const [x, z] of [
      [0, 3.4],
      [-6, -3],
      [2.5, -5],
    ] as const) {
      expect(groundHeight(x, z)).toBe(SAE_FLOOR_Y);
    }
    expect(SAE_FLOOR_Y).toBeGreaterThan(groundHeight(0, 7.5));
  });

  it('室内の歩ける所は、入口からひと続きで、引っかかって出られない場所がない', () => {
    expect(map.reachedCount / map.freeCount).toBeGreaterThan(0.97);
    // 室内の外へは歩いて出られない（出入りは入口の E だけ）
    const s = walk(SAE_INTERIOR.entry, 0, 5, walkWorld(inside, bounds));
    expect(isInsideSaeHouse(s.x, s.z)).toBe(true);
  });

  it.each(INTERACTABLES.filter((i) => i.indoor).map((i) => [i.label, i] as const))('室内の「%s」に、入口から歩いて近づける', (_, def) => {
    expect(isInsideSaeHouse(def.position.x, def.position.z)).toBe(true);
    expect(map.nearestReachable(def.position)).toBeLessThan(def.range - 0.4);
  });

  it('外の入口は、外から近づける。室内の入口は、入った位置のすぐそば', () => {
    const outside = buildReachability([...outdoor, ...npcColliders()], WALK_BOUNDS, PLAYER_START.position, R);
    const door = INTERACTABLES.find((i) => i.id === 'saeDoor')!;
    expect(outside.nearestReachable(door.position)).toBeLessThan(door.range - 0.4);
    const inner = INTERACTABLES.find((i) => i.id === 'saeDoorInside')!;
    expect(map.nearestReachable(inner.position)).toBeLessThan(inner.range - 0.4);
    // 出たときの位置からは、外の入口がすぐ操作できる（出たり入ったりが自然にできる）
    expect(Math.hypot(door.position.x - SAE_INTERIOR.exit.x, door.position.z - SAE_INTERIOR.exit.z)).toBeLessThan(door.range);
  });

  it('屋内では室内の物だけ、屋外では外の物だけを操作できる（壁越しに操作できない）', () => {
    const story = new StoryState(STORY_DEFS);
    const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story);
    // 外の入口の前に立つ：室内の入口・結帳は選ばれない
    sys.updateTarget({ x: 0, z: 7.0, heading: Math.PI });
    expect(sys.target?.id).toBe('saeDoor');
    sys.setIndoor(true);
    sys.updateTarget({ x: 0, z: 4.6, heading: 0 });
    expect(sys.target?.id).toBe('saeDoorInside');
    // 室内の南の壁際からも、外のサエ・屋根は選ばれない
    sys.updateTarget({ x: 3.0, z: 5.3, heading: 0 });
    expect(['saeDoorInside', null]).toContain(sys.target?.id ?? null);
    for (const d of OUTDOOR_INTERACTABLES) expect(d.indoor ?? false).toBe(false);
  });
});

// ───────── 出入りの許しと、結帳の進行 ─────────

describe('サエ家に入る許しと結帳', () => {
  const doorText = (story: StoryState) => {
    const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story);
    sys.updateTarget({ x: 0, z: 7.0, heading: Math.PI });
    sys.interact();
    const lines: string[] = [];
    while (sys.isActive) {
      lines.push(plainText(sys.view!.text));
      sys.advance();
    }
    return lines.join('／');
  };

  it('サエに頼むまでは入れない。頼むと入れる（以後はいつでも）', () => {
    const story = new StoryState(STORY_DEFS);
    expect(evaluate(SAE_HOUSE_OPEN, story)).toBe(false);
    expect(doorText(story)).toContain('サエさんに断ってから');
    story.set('asked:saeLedger');
    expect(evaluate(SAE_HOUSE_OPEN, story)).toBe(true);
    expect(doorText(story)).toContain('サエ家に上がる');
  });

  it('前の版の記録（結帳をすでに読んだ）では、頼まなくても入れる', () => {
    const story = new StoryState(STORY_DEFS);
    story.learn('ledger.basics', 'read');
    expect(evaluate(SAE_HOUSE_OPEN, story)).toBe(true);
  });

  it('目的表示：まずサエに頼む → 家に上がって結帳を確かめる', () => {
    const story = new StoryState(STORY_DEFS);
    for (const f of ['talked:toki', 'talked:sae', 'talked:isuke']) story.set(f);
    story.learn('isuke.availability', 'harvest');
    expect(currentObjective(story)).toBe('サエに、結帳を見せてもらえるか頼む');
    story.set('asked:saeLedger');
    expect(currentObjective(story)).toBe('サエ家に上がって、結帳を確かめる');
  });

  it('どの章のサエとの会話にも、結帳を見せてもらう選択肢がある（頼むまで）＝家に入れなくて詰まらない', () => {
    const askTexts = ['結帳を見てもいいですか？', '結帳を見せてもらえますか？'];
    const sae = DIALOGUES.sae!;
    const hasAsk = (node: string) => (sae.nodes[node]?.choices ?? []).some((c) => askTexts.includes(c.text));
    for (const node of ['first', 'again', 'more', 'dayEnd', 'ch3', 'ch3Again', 'injury', 'endE1', 'endE2', 'endE3']) {
      expect(hasAsk(node), node).toBe(true);
    }
    // 頼んだ後・読んだ後は出ない
    const story = new StoryState(STORY_DEFS);
    story.set('asked:saeLedger');
    for (const node of ['more', 'dayEnd', 'ch3', 'endE1']) {
      const visible = (sae.nodes[node]?.choices ?? []).filter((c) => evaluate(c.when, story)).map((c) => c.text);
      expect(visible.some((t) => askTexts.includes(t)), node).toBe(false);
    }
  });

  it('結帳の画面・中身・解放条件は変わらない（読むと ledger.basics を知る）', () => {
    const ledger = INTERACTABLES.find((i) => i.id === 'ledger')!;
    expect(ledger.kind === 'object' && ledger.opens).toBe('ledger');
    expect(ledger.indoor).toBe(true);
    const story = new StoryState(STORY_DEFS);
    const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story);
    sys.setIndoor(true);
    sys.updateTarget({ x: ledger.position.x, z: ledger.position.z + 0.6, heading: Math.PI });
    expect(sys.target?.id).toBe('ledger');
    sys.interact();
    while (sys.isActive) sys.advance();
    expect(story.currentStage('ledger.basics')).toBe('read');
    expect(story.currentStage('isuke.pastHelp')).toBe('onRecord');
  });

  it('室内で記録した位置は、読み込むと室内として戻せる', () => {
    const story = new StoryState(STORY_DEFS);
    story.set('asked:saeLedger');
    const save = createSave(story.snapshot(), { x: 1.4, z: -3.8, heading: Math.PI });
    const parsed = parseSave(JSON.stringify(save), STORY_DEFS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(isInsideSaeHouse(parsed.save.player.x, parsed.save.player.z)).toBe(true);
    expect(overlapsAny(parsed.save.player, R, saeInteriorColliders())).toBe(false);
  });
});
