import { describe, expect, it } from 'vitest';
import { penetration } from '../src/core/collision';
import { CHARACTERS } from '../src/content/characters';
import { DIALOGUES } from '../src/content/dialogues';
import { INTERACTABLES, NPCS, NPC_COLLIDER_RADIUS, npcColliders } from '../src/content/interactables';
import { OBJECTIVES, currentObjective } from '../src/content/objectives';
import { validateScript } from '../src/dialogue/validate';
import { InteractionSystem } from '../src/interaction/InteractionSystem';
import { completionFlag } from '../src/interaction/types';
import { referencedFlags, type FlagId } from '../src/story/conditions';
import { StoryState } from '../src/story/StoryState';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, LOCATIONS, PATHS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, distanceToSegment } from '../src/world/layout';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 1 の会話・調査データ（src/content）の整合性テスト。
 * 会話や住民を追加したときに、参照切れ・進行不能・配置ミスを検出する。
 */

const speakers = new Set(Object.keys(CHARACTERS));

describe('会話データ', () => {
  it.each(Object.entries(DIALOGUES))('「%s」の構造に問題がない', (_, script) => {
    expect(validateScript(script, speakers)).toEqual([]);
  });

  it('会話 ID とキーが一致する', () => {
    for (const [key, script] of Object.entries(DIALOGUES)) expect(script.id).toBe(key);
  });

  it('条件で参照するフラグは、すべてゲーム中に立てられるもの', () => {
    const producible = new Set<FlagId>();
    for (const def of INTERACTABLES) producible.add(completionFlag(def));
    for (const loc of LOCATIONS) producible.add(`visited:${loc.id}`);
    const referenced = new Set<FlagId>();
    for (const script of Object.values(DIALOGUES)) {
      for (const e of script.entries) referencedFlags(e.when).forEach((f) => referenced.add(f));
      for (const node of Object.values(script.nodes)) {
        node.effects?.forEach((e) => producible.add(e.flag));
        for (const c of node.choices ?? []) {
          c.effects?.forEach((e) => producible.add(e.flag));
          referencedFlags(c.when).forEach((f) => referenced.add(f));
        }
      }
    }
    for (const o of OBJECTIVES) referencedFlags(o.when).forEach((f) => referenced.add(f));
    const unknown = [...referenced].filter((f) => !producible.has(f));
    expect(unknown).toEqual([]);
  });
});

describe('インタラクション対象の定義', () => {
  it('ID が重複せず、会話データと人物が存在する', () => {
    const ids = INTERACTABLES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of INTERACTABLES) {
      expect(DIALOGUES[def.dialogue], def.id).toBeDefined();
      if (def.kind === 'npc') expect(speakers.has(def.character), def.id).toBe(true);
    }
  });

  it('設計書 D 節の5人が村に配置されている', () => {
    expect(NPCS.map((n) => n.character).sort()).toEqual(Object.keys(CHARACTERS).sort());
  });
});

describe('住民と調査対象の配置', () => {
  const world = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
  const radius = DEFAULT_PLAYER_TUNING.radius;

  it('住民は建物・木・小物と重ならない', () => {
    for (const npc of NPCS) {
      for (const c of world) {
        expect(penetration(npc.position, NPC_COLLIDER_RADIUS, c), npc.id).toBeNull();
      }
    }
  });

  it('住民は道をふさがない', () => {
    for (const npc of NPCS) {
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          const d = distanceToSegment(npc.position.x, npc.position.z, path.points[i]!, path.points[i + 1]!);
          // 道幅の半分＋住民＋プレイヤーがすれ違える余裕
          expect(d, npc.id).toBeGreaterThan(path.width / 2 + NPC_COLLIDER_RADIUS + 0.2);
        }
      }
    }
  });

  const map = buildReachability([...world, ...npcColliders()], WALK_BOUNDS, PLAYER_START.position, radius);

  it.each(INTERACTABLES.map((i) => [i.label, i] as const))(
    'スタート地点から歩いて「%s」に話しかけられる・調べられる位置まで行ける',
    (_, def) => {
      // 格子の間隔（0.5m）の分だけ余裕を見る
      expect(map.nearestReachable(def.position)).toBeLessThan(def.range - 0.4);
    },
  );
});

describe('目的表示', () => {
  it('最後の目的は条件なし（必ず何か表示される）', () => {
    expect(OBJECTIVES[OBJECTIVES.length - 1]?.when).toBeUndefined();
  });

  it('進行に応じて目的が変わる', () => {
    const s = new StoryState();
    expect(currentObjective(s)).toBe('広場にいるトキに話しかける');
    s.set('talked:toki');
    expect(currentObjective(s)).toBe('サエ家を訪ねる');
    s.set('talked:sae');
    expect(currentObjective(s)).toBe('伊助・宗平・ミネに話を聞く');
  });
});

/** 選択肢を指定した順に選びながら、会話を最後まで進める。 */
function talk(sys: InteractionSystem, id: string, pick: (choices: readonly string[]) => number = () => 0): string[] {
  const def = INTERACTABLES.find((i) => i.id === id)!;
  // 対象の正面に立って話しかける
  sys.updateTarget({ x: def.position.x, z: def.position.z - 1, heading: 0 });
  expect(sys.target?.id).toBe(id);
  sys.interact();
  const seen: string[] = [];
  for (let guard = 0; sys.isActive; guard++) {
    if (guard > 100) throw new Error(`${id} の会話が終わらない`);
    const view = sys.view!;
    seen.push(view.text);
    if (view.choices.length > 0) sys.choose(pick(view.choices.map((c) => c.text)));
    else sys.advance();
  }
  return seen;
}

describe('仮シナリオの通し確認（Phase 1 の仕組みの確認用）', () => {
  it('すべての住民・調査対象と、どの選択肢を選んでも会話を終えられる', () => {
    for (const choiceIndex of [0, 1, 2]) {
      const story = new StoryState();
      const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story);
      for (let round = 0; round < 2; round++) {
        for (const def of INTERACTABLES) talk(sys, def.id, (c) => Math.min(choiceIndex, c.length - 1));
      }
      for (const def of INTERACTABLES) expect(story.has(completionFlag(def))).toBe(true);
    }
  });

  it('伊助の事情は、はさ掛けを調べた後でなければ聞けない', () => {
    const story = new StoryState();
    const sys = new InteractionSystem(INTERACTABLES, DIALOGUES, story);
    const isukeChoices: string[][] = [];
    const record = (c: readonly string[]) => {
      isukeChoices.push([...c]);
      return c.length - 1; // 最後の選択肢（会話を切り上げる）
    };

    talk(sys, 'isuke', record);
    expect(isukeChoices[0]).not.toContain('畑のはさ掛けを見てきました');
    expect(story.has('fact:isukeHarvest')).toBe(false);

    // 断られた後、トキが畑を見るよう勧める（未確認の情報は話さない）
    const tokiLines = talk(sys, 'toki');
    expect(tokiLines.join()).toContain('畑のほう');
    expect(tokiLines.join()).not.toContain('刈り入れ');

    talk(sys, 'hasaRack');
    expect(story.has('inspected:hasaRack')).toBe(true);

    const lines = talk(sys, 'isuke', (c) => c.indexOf('畑のはさ掛けを見てきました'));
    expect(lines.join()).toContain('刈り入れ');
    expect(story.has('fact:isukeHarvest')).toBe(true);
    // 事情を知った後は、伊助の最初の台詞も変わる
    expect(talk(sys, 'isuke')[0]).toContain('刈り入れが済むまでは');
    expect(currentObjective(story)).not.toBe('伊助が断った理由を探る');
  });
});
