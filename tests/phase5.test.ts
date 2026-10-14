import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThatchRoof, ROOF_STATES, type ThatchRoofSpec } from '../src/world/builders/thatch';
import { southSideOf } from '../src/world/World';
import { BUILDINGS, PADDIES, PATHS, PLAYER_START, PROPS, TREES, WALK_BOUNDS, WATERWAY, distanceToSegment } from '../src/world/layout';
import { penetration } from '../src/core/collision';
import { buildCollisionMap, buildingCollider, propCollider } from '../src/world/collisionMap';
import { CHARACTERS, VILLAGER_LOOKS } from '../src/content/characters';
import { INTERACTABLES, NPCS } from '../src/content/interactables';
import { OUTCOMES, OUTCOME_IDS, parseOutcomeId } from '../src/content/plan';
import { CREW_RADIUS, npcStyle, roofDayColliders, roofDayStage, roofStates, staticCrew } from '../src/content/staging';
import { POSE_KEYS, addTalkGesture, heldPropFor, idlePose, walkPose } from '../src/characters/poses';
import { createPersonRig, personMaterial } from '../src/characters/personRig';
import { PLAYER_APPEARANCE } from '../src/player/PlayerView';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 5（docs/PHASE5_ART.md）：茅葺き屋根の形と状態、物語の状態に応じた見た目（屋根・立ち姿・屋根葺きの日）、
 * 人物の見分けやすさ、配置の変更（サエ家の向き・田んぼ・暮らしの道具）。
 */

const SPEC: ThatchRoofSpec = {
  halfSpan: 6.3,
  pitch: THREE.MathUtils.degToRad(58),
  thickness: 0.95,
  halfDepth: 8.3,
  eaveLow: 4.3,
  southSide: -1,
  damage: { zFrom: 0.14, zTo: 0.46, uTo: 0.62 },
  seed: 3,
};

/** 上面の頂点の色（side 側、棟方向の割合 v、軒先からの割合 u に最も近い頂点）。 */
function topColor(roof: ReturnType<typeof createThatchRoof>, side: 1 | -1, u: number, v: number): THREE.Color {
  const target = roof.surfacePoint(side, u, v);
  const pos = roof.geometry.attributes.position as THREE.BufferAttribute;
  const col = roof.geometry.attributes.color as THREE.BufferAttribute;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const d = (pos.getX(i) - target.x) ** 2 + (pos.getY(i) - target.y) ** 2 + (pos.getZ(i) - target.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return new THREE.Color(col.getX(best), col.getY(best), col.getZ(best));
}

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('茅葺き屋根（Phase 5）', () => {
  it('急勾配の切妻で、厚みがあり、棟が軒先より十分に高い', () => {
    const roof = createThatchRoof(SPEC);
    expect(roof.ridgeY - roof.topEaveY).toBeGreaterThan(9);
    expect(roof.ridgeY).toBeGreaterThan(roof.innerApexY + 1);
    roof.geometry.computeBoundingBox();
    const box = roof.geometry.boundingBox!;
    expect(box.max.x).toBeCloseTo(SPEC.halfSpan, 0);
    expect(box.min.y).toBeCloseTo(SPEC.eaveLow, 1);
    expect(box.max.z).toBeCloseTo(SPEC.halfDepth, 3);
  });

  it('四つの状態で色が変わり、葺き替えは南面だけに表れる', () => {
    const roof = createThatchRoof(SPEC);
    const south = SPEC.southSide;
    const north = (-south) as 1 | -1;
    const at = (state: (typeof ROOF_STATES)[number], side: 1 | -1, u: number, v: number) => {
      roof.setState(state);
      return topColor(roof, side, u, v);
    };
    // 傷んだ所（南面の西側の下の方）は、ふつうの所より暗い
    expect(lum(at('old', south, 0.3, 0.3))).toBeLessThan(lum(at('old', south, 0.3, 0.8)) * 0.85);
    // 葺き替えると南面は明るくなり、北面は変わらない
    expect(lum(at('renewed', south, 0.5, 0.7))).toBeGreaterThan(lum(at('old', south, 0.5, 0.7)) * 1.4);
    expect(at('renewed', north, 0.5, 0.5).equals(at('old', north, 0.5, 0.5))).toBe(true);
    // 一部だけ：傷んだ所は新しく、それ以外の南面は古いまま
    expect(lum(at('partial', south, 0.3, 0.3))).toBeGreaterThan(lum(at('old', south, 0.3, 0.3)) * 1.6);
    expect(lum(at('partial', south, 0.5, 0.85))).toBeCloseTo(lum(at('old', south, 0.5, 0.85)), 3);
    // 傷み（第3幕の伊助家）：全体が暗くなる
    expect(lum(at('worn', north, 0.5, 0.5))).toBeLessThan(lum(at('old', north, 0.5, 0.5)));
    roof.setState('worn');
    expect(roof.state).toBe('worn');
  });

  it('南を向く屋根の面を、家の向きから正しく求める', () => {
    // サエ家（棟が東西）は -X 側の面が南、伊助家は +X 側の面が南
    expect(southSideOf(BUILDINGS.find((b) => b.id === 'sae')!.rotation)).toBe(-1);
    expect(southSideOf(BUILDINGS.find((b) => b.id === 'isuke')!.rotation)).toBe(1);
    expect(southSideOf(BUILDINGS.find((b) => b.id === 'mine')!.rotation)).toBe(-1);
    // 南面の法線は +Z を向く
    for (const id of ['sae', 'isuke', 'mine']) {
      const b = BUILDINGS.find((x) => x.id === id)!;
      const side = southSideOf(b.rotation);
      const normalWorld = new THREE.Vector3(side, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
      expect(normalWorld.z, id).toBeGreaterThan(0.99);
    }
  });
});

// ───────── 物語の状態に応じた見た目（content/staging.ts） ─────────

describe('屋根の見た目は章と決定から決まる', () => {
  it('第1幕・当日は傷んだまま、三年後はミネの茅なら南面すべて・手持ちなら一部だけ新しい', () => {
    for (const ch of ['ch1', 'roofDay'] as const) expect(roofStates(ch, 'solo-full', undefined)).toEqual({ sae: 'old', isuke: 'old' });
    for (const id of OUTCOME_IDS) {
      const full = id.endsWith('-full');
      expect(roofStates('ch3', id, undefined), id).toEqual({ sae: full ? 'renewed' : 'partial', isuke: 'worn' });
    }
  });

  it('伊助家の屋根：第3幕で葺いた結末（E1・E2）は新しく、見送った結末（E3）は傷んだまま', () => {
    expect(roofStates('end', 'prep-part', 'e1').isuke).toBe('renewed');
    expect(roofStates('end', 'prep-part', 'e2').isuke).toBe('renewed');
    expect(roofStates('end', 'prep-part', 'e3').isuke).toBe('worn');
  });
});

describe('屋根葺きの日の人と物は、計画の結果と一致する', () => {
  const world = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });

  it.each(OUTCOME_IDS)('「%s」：作業の場にいる名前のある住民は、結果の placements にいる人だけ', (id) => {
    const stage = roofDayStage(id)!;
    const placed = Object.keys(OUTCOMES[id]!.placements).sort();
    expect(Object.keys(stage.roles).sort()).toEqual(placed);
    // 延ばした計画だけ伊助が来る。延ばした計画では、ミネは茅刈りで来ない（Phase 4 と同じ）
    const family = parseOutcomeId(id)!.family;
    const delayed = family === 'wait' || family === 'waitHelp';
    expect('isuke' in stage.roles).toBe(delayed);
    expect('mine' in stage.roles).toBe(!delayed && stage.mineKaya);
    expect(stage.roles.sohei).toBe('direct');
    // 名前のある住民の立ち姿は、その役割になる（来ていない人は普段の立ち姿のまま）
    for (const c of Object.keys(CHARACTERS) as Array<keyof typeof CHARACTERS>) {
      const style = npcStyle(c, CHARACTERS[c].idle, 'roofDay', id);
      expect(style, c).toBe(stage.roles[c] ?? CHARACTERS[c].idle);
    }
  });

  it.each(OUTCOME_IDS)('「%s」：ミネの茅・足場の範囲・人手が、結果の会話と結帳に合う', (id) => {
    const stage = roofDayStage(id)!;
    const o = parseOutcomeId(id)!;
    // ミネの茅を借りた計画だけ、新しい茅の山（東側）があり、足場が南面いっぱいになる
    expect(stage.mineKaya).toBe(o.full);
    expect(stage.piles.some((p) => p.id === 'mine')).toBe(o.full);
    expect(stage.extent).toBe(o.full ? 'full' : 'part');
    expect(OUTCOMES[id]!.ledger.items.some((i) => i.id === 'L3-mine')).toBe(o.full);
    // 予定日・伊助なし（「人手は少ない」）は、ほかの計画より手伝いの人が少ない
    const crewOf = (x: string) => roofDayStage(x)!.crew.length;
    if (o.family === 'solo') {
      for (const other of ['prep', 'wait', 'waitHelp']) expect(stage.crew.length).toBeLessThan(crewOf(`${other}-${o.full ? 'full' : 'part'}`));
    }
    // 名前のない人の見た目は用意したものから選ぶ。ID は重ならない
    expect(new Set(stage.crew.map((c) => c.id)).size).toBe(stage.crew.length);
    for (const c of stage.crew) expect(c.look).toBeLessThan(VILLAGER_LOOKS.length);
  });

  it.each(OUTCOME_IDS)('「%s」：茅を運ぶ人の往復は、障害物・道・ほかの人と重ならない', (id) => {
    const stage = roofDayStage(id)!;
    const placements = OUTCOMES[id]!.placements;
    const people = [
      ...NPCS.map((n) => placements[n.character]?.position ?? n.position),
      ...staticCrew(stage).map((c) => c.position),
    ];
    const blockers = [...world, ...roofDayColliders(stage)];
    const carriers = stage.crew.filter((c) => c.role === 'carry');
    expect(carriers.length).toBeGreaterThan(0);
    for (const c of carriers) {
      for (let k = 0; k <= 20; k++) {
        const p = { x: c.position.x + ((c.to!.x - c.position.x) * k) / 20, z: c.position.z + ((c.to!.z - c.position.z) * k) / 20 };
        for (const b of blockers) expect(penetration(p, CREW_RADIUS, b), `${c.id} ${p.x},${p.z}`).toBeNull();
        for (const q of people) expect(Math.hypot(q.x - p.x, q.z - p.z), c.id).toBeGreaterThan(0.85);
        for (const path of PATHS) {
          for (let i = 0; i + 1 < path.points.length; i++) {
            expect(distanceToSegment(p.x, p.z, path.points[i]!, path.points[i + 1]!)).toBeGreaterThan(path.width / 2 + CREW_RADIUS);
          }
        }
      }
    }
  });

  it('屋根の上の人は、足場の範囲の中にいる', () => {
    for (const id of OUTCOME_IDS) {
      const stage = roofDayStage(id)!;
      const [v0, v1] = stage.extent === 'full' ? [0.05, 0.95] : [0.1, 0.5];
      for (const c of stage.crew.filter((m) => m.role === 'roof')) {
        expect(c.roofSpot!.v, id).toBeGreaterThanOrEqual(v0);
        expect(c.roofSpot!.v, id).toBeLessThanOrEqual(v1);
      }
    }
  });
});

describe('住民の立ち姿', () => {
  it('第3幕以降のサエは杖をつく（それより前はつかない）', () => {
    expect(npcStyle('sae', 'handsFront', 'ch1', undefined)).toBe('handsFront');
    expect(npcStyle('sae', 'handsFront', 'roofDay', 'solo-part')).toBe('handsFront');
    expect(npcStyle('sae', 'handsFront', 'ch3', 'solo-part')).toBe('cane');
    expect(npcStyle('sae', 'handsFront', 'end', 'solo-part')).toBe('cane');
    expect(heldPropFor('cane')).toBe('cane');
  });

  it('5 人の待機の姿勢はそれぞれ違う（全員が同じ棒立ちにならない）', () => {
    const ids = Object.keys(CHARACTERS) as Array<keyof typeof CHARACTERS>;
    const poses = ids.map((id) => idlePose(CHARACTERS[id].idle, 1.3, 0));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const diff = POSE_KEYS.reduce((s, k) => s + Math.abs(poses[i]![k] - poses[j]![k]), 0);
        expect(diff, `${ids[i]} / ${ids[j]}`).toBeGreaterThan(0.3);
      }
    }
  });

  it('すべての型で、姿勢は有限の値で、時間とともに動く', () => {
    const styles = ['calm', 'fidget', 'handsFront', 'armsCrossed', 'holdBook', 'lookField', 'cane', 'direct', 'carry', 'holdKaya', 'pass', 'tamp', 'sort', 'watch'] as const;
    for (const s of styles) {
      const a = idlePose(s, 0.5, 1);
      const b = idlePose(s, 2.7, 1);
      for (const k of POSE_KEYS) expect(Number.isFinite(a[k]), `${s}.${k}`).toBe(true);
      expect(POSE_KEYS.some((k) => Math.abs(a[k] - b[k]) > 1e-3), s).toBe(true);
    }
  });

  it('話している間は手振りが付く。腕を組んでいるときはうなずくだけ', () => {
    const base = idlePose('handsFront', 1, 0);
    const talk = addTalkGesture(idlePose('handsFront', 1, 0), 'handsFront', 1, 1);
    expect(Math.abs(talk.rArmX - base.rArmX)).toBeGreaterThan(0.05);
    const crossed = idlePose('armsCrossed', 1, 0);
    const crossedTalk = addTalkGesture(idlePose('armsCrossed', 1, 0), 'armsCrossed', 1, 1);
    expect(crossedTalk.rArmX).toBe(crossed.rArmX);
    expect(crossedTalk.lArmX).toBe(crossed.lArmX);
    expect(crossedTalk.headX).not.toBe(crossed.headX);
  });

  it('歩く姿勢：左右の脚を交互に振り、止まると揃う', () => {
    const w = walkPose(Math.PI / 2, 0.5, true);
    expect(w.lLegX).toBeCloseTo(-w.rLegX, 6);
    expect(Math.abs(w.lLegX)).toBeGreaterThan(0.2);
    expect(walkPose(Math.PI / 2, 0.5, false).lLegX).toBe(0);
  });
});

describe('人物の見分けやすさ', () => {
  const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as const;
  const looks = {
    player: PLAYER_APPEARANCE,
    ...Object.fromEntries(Object.values(CHARACTERS).map((c) => [c.id, c.appearance])),
  };

  it('主人公と 5 人の上着の色は、互いに十分違う', () => {
    const entries = Object.entries(looks);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = rgb(entries[i]![1].cloth);
        const b = rgb(entries[j]![1].cloth);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(d, `${entries[i]![0]} / ${entries[j]![0]}`).toBeGreaterThan(60);
      }
    }
  });

  it('シルエット（かぶり物・上着の丈・持ち物・前掛け・たすき）の組み合わせが、全員違う', () => {
    const sig = Object.values(looks).map(
      (l) => `${l.headwear}|${l.coat ?? 'short'}|${l.pack ?? '-'}|${l.apron !== undefined}|${l.tasuki !== undefined}|${l.beard === true}`,
    );
    expect(new Set(sig).size).toBe(sig.length);
  });

  it('名前のない村の人たちは、名前のある住民より落ち着いた色（彩度が低い）', () => {
    const sat = (hex: number) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).s;
    // 宗平は墨色（無彩色に近い）なので、彩度ではなく丈の長い上着と白髪・ひげで見分ける
    const named = Object.values(CHARACTERS)
      .filter((c) => c.id !== 'sohei')
      .map((c) => sat(c.appearance.cloth));
    const minNamed = Math.min(...named);
    for (const v of VILLAGER_LOOKS) expect(sat(v.cloth)).toBeLessThan(minNamed);
  });

  it('人物のモデルは部位ごとにまとめられ、一人あたりの描画は 8 回以内（全員が同じマテリアル）', () => {
    for (const look of [PLAYER_APPEARANCE, ...Object.values(CHARACTERS).map((c) => c.appearance), ...VILLAGER_LOOKS]) {
      const rig = createPersonRig(look);
      let visible = 0;
      rig.root.traverseVisible((o) => {
        if (o instanceof THREE.Mesh) visible++;
      });
      expect(visible).toBeLessThanOrEqual(8);
      rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) expect(o.material).toBe(personMaterial());
      });
    }
  });
});

describe('村の配置（Phase 5 の変更）', () => {
  const colliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });

  it('サエ家の南面の前（調べる場所・結帳・入口）に行ける', () => {
    const map = buildReachability(colliders, WALK_BOUNDS, PLAYER_START.position, DEFAULT_PLAYER_TUNING.radius);
    for (const id of ['saeRoof', 'ledger']) {
      const def = INTERACTABLES.find((i) => i.id === id)!;
      expect(map.nearestReachable(def.position), id).toBeLessThan(def.range - 0.4);
    }
    // サエ家の入口（南の長い辺の中央）の手前まで行ける
    expect(map.nearestReachable({ x: 0, z: 7.4 })).toBeLessThan(0.6);
  });

  it('Phase 5 で足した・動かした小物（暮らしの道具・薪・はさ掛け）は、道の上に置かない', () => {
    const kinds = new Set(['tub', 'basket', 'toolRack', 'ladderRack', 'ropeCoil', 'woodpile', 'hasaRack', 'ledgerBox']);
    for (const prop of PROPS.filter((x) => kinds.has(x.kind))) {
      const c = propCollider(prop);
      if (!c) continue;
      for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
          const a = path.points[i]!;
          const b = path.points[i + 1]!;
          const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
          for (let k = 0; k <= n; k++) {
            const pt = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
            expect(penetration(pt, path.width / 2, c), prop.kind).toBeNull();
          }
        }
      }
    }
  });

  it('田んぼは水路・建物と重ならない', () => {
    for (const f of PADDIES) {
      expect(f.position.z - f.halfDepth).toBeGreaterThan(WATERWAY.centerZ + WATERWAY.halfWidth);
      for (const b of BUILDINGS) expect(penetration(f.position, Math.max(f.halfWidth, f.halfDepth), buildingCollider(b)), b.id).toBeNull();
    }
  });
});
