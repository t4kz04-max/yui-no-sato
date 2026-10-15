import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_ORBIT_LIMITS, INDOOR_ORBIT_LIMITS, WORKSHOP_ORBIT_LIMITS, applyOrbitInput, createOrbitState, splitPitch } from '../src/camera/orbit';
import { overlapsAny } from '../src/core/collision';
import { CHARACTERS, VILLAGER_LOOKS } from '../src/content/characters';
import { INTERACTABLES, NPCS } from '../src/content/interactables';
import { FaceAnimator } from '../src/characters/face';
import { applyFace, applyPose, createPersonRig, kneeBend } from '../src/characters/personRig';
import { idlePose, neutralPose, walkPose } from '../src/characters/poses';
import { DEFAULT_PLAYER_TUNING } from '../src/player/PlayerController';
import { PLAYER_APPEARANCE } from '../src/player/PlayerView';
import { buildCollisionMap } from '../src/world/collisionMap';
import { BUILDINGS, PLAYER_START, PROPS, TREES, WALK_BOUNDS } from '../src/world/layout';
import { WORKSHOP_FLOOR_Y, groundHeight, terrainHeight } from '../src/world/terrain';
import { WORKSHOP, isInsideWorkshop, isOnWorkshopFloor, workshopColliders } from '../src/world/workshop';
import { createThatchRoof, type ThatchRoofSpec } from '../src/world/builders/thatch';
import { buildReachability } from './helpers/reachability';

/**
 * Phase 6.5（docs/PHASE6_5_PLAN.md）：見上げるカメラと観察の構図、屋根の傷みの見え方、
 * 宗平の作業場に入れること、人物のスキンメッシュ（膝・表情）。
 */

describe('カメラ：見上げ', () => {
  it('屋外では上下角を負（見上げ）まで動かせる。室内・作業場の中は見上げない', () => {
    const s = createOrbitState(0);
    for (let i = 0; i < 200; i++) applyOrbitInput(s, { lookX: 0, lookY: -50, zoom: 0 }, 1 / 60);
    expect(s.targetPitch).toBe(DEFAULT_ORBIT_LIMITS.minPitch);
    expect(DEFAULT_ORBIT_LIMITS.minPitch).toBeLessThan(-0.5);
    expect(INDOOR_ORBIT_LIMITS.minPitch).toBeGreaterThan(0);
    expect(WORKSHOP_ORBIT_LIMITS.minPitch).toBeGreaterThan(0);
  });

  it('見上げるとき、カメラの高さを決める角度は下限で止まり、残りは視線の傾きになる（地面に潜らない）', () => {
    expect(splitPitch(0.4)).toEqual({ position: 0.4, lookUp: 0 });
    const up = splitPitch(-0.6);
    expect(up.position).toBeGreaterThan(0);
    expect(up.lookUp).toBeCloseTo(up.position + 0.6);
  });

  it('サエ家の屋根を調べる間の観察の構図は、広場の歩ける所から、屋根の高い所（傷んだ所）を見上げる', () => {
    const roof = INTERACTABLES.find((i) => i.id === 'saeRoof');
    expect(roof?.kind).toBe('object');
    if (roof?.kind !== 'object') return;
    const v = roof.view!;
    expect(v.look.y - v.pos.y).toBeGreaterThan(4);
    expect(v.pos.y - terrainHeight(v.pos.x, v.pos.z)).toBeGreaterThan(1);
    const colliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
    expect(overlapsAny({ x: v.pos.x, z: v.pos.z }, 0.3, colliders)).toBe(false);
  });
});

describe('屋根の傷み（形の乱れ）', () => {
  const spec: ThatchRoofSpec = {
    halfSpan: 6.3,
    pitch: THREE.MathUtils.degToRad(58),
    thickness: 0.95,
    halfDepth: 8.3,
    eaveLow: 4.3,
    southSide: -1,
    damage: { zFrom: 0.14, zTo: 0.46, uTo: 0.62 },
    seed: 3,
  };

  it('傷みのある屋根には乱れた茅の房があり、傷みのない屋根にはない', () => {
    expect(createThatchRoof(spec).tufts!.attributes.position!.count).toBeGreaterThan(300);
    expect(createThatchRoof({ ...spec, damage: null }).tufts).toBeNull();
  });

  it('茅の房は傷みの範囲（南面・西寄り）だけにある', () => {
    const roof = createThatchRoof(spec);
    const pos = roof.tufts!.attributes.position as THREE.BufferAttribute;
    const zMin = -spec.halfDepth + 2 * spec.halfDepth * (spec.damage!.zFrom - 0.12);
    const zMax = -spec.halfDepth + 2 * spec.halfDepth * (spec.damage!.zTo + 0.12);
    for (let i = 0; i < pos.count; i++) {
      expect(Math.sign(pos.getX(i))).toBe(spec.southSide);
      expect(pos.getZ(i)).toBeGreaterThan(zMin);
      expect(pos.getZ(i)).toBeLessThan(zMax);
    }
  });

  it('茅の房は屋根の状態が old（傷んだまま）のときだけ見え、葺き替え後は消える', () => {
    const roof = createThatchRoof(spec);
    const obj = new THREE.Object3D();
    roof.tuftObject = obj;
    roof.setState('renewed');
    expect(obj.visible).toBe(false);
    roof.setState('partial');
    expect(obj.visible).toBe(false);
    roof.setState('old');
    expect(obj.visible).toBe(true);
  });
});

describe('宗平の作業場に入れる', () => {
  const colliders = buildCollisionMap({ buildings: BUILDINGS, props: PROPS, trees: TREES });
  const r = DEFAULT_PLAYER_TUNING.radius;
  const c = WORKSHOP.center;

  it('正面の開口から中へ歩いて入れ、中の作業台の前まで行ける（閉じ込められない＝同じ道で出られる）', () => {
    const map = buildReachability(colliders, WALK_BOUNDS, PLAYER_START.position, r);
    // 中の何か所か（開口の内側・中央・作業台の前・木挽き台の前）
    for (const p of [
      { x: c.x, z: c.z + 2.0 },
      { x: c.x, z: c.z + 0.2 },
      { x: c.x + 2.0, z: c.z + 0.4 },
      { x: c.x - 2.3, z: c.z + 0.6 },
    ]) {
      expect(map.nearestReachable(p), JSON.stringify(p)).toBeLessThan(0.4);
    }
  });

  it('壁と中の物はすり抜けられない（壁・材木・作業台の上には立てない）', () => {
    for (const p of [
      { x: c.x, z: c.z - 2.9 }, // 奥の壁
      { x: c.x + 3.9, z: c.z }, // 右の壁
      { x: c.x - 3.9, z: c.z }, // 左の壁
      { x: c.x + 3.2, z: c.z + 2.9 }, // 正面の右の壁
      { x: c.x - 3.2, z: c.z + 2.9 }, // 正面の左の壁
      { x: c.x - 0.6, z: c.z - 2.33 }, // 材木
      { x: c.x + 2.0, z: c.z - 0.6 }, // 作業台
    ]) {
      expect(overlapsAny(p, r, colliders), JSON.stringify(p)).toBe(true);
    }
  });

  it('中の物の判定は、正面の開口をふさがない', () => {
    for (let x = -WORKSHOP.door.halfWidth + 0.5; x <= WORKSHOP.door.halfWidth - 0.5; x += 0.25) {
      expect(overlapsAny({ x: c.x + x, z: c.z + 2.9 }, r, workshopColliders()), String(x)).toBe(false);
    }
  });

  it('床は平らで、外の地面より少し高い（土台の上）。壁の内側だけカメラを近めにする', () => {
    expect(isOnWorkshopFloor(c.x, c.z)).toBe(true);
    expect(groundHeight(c.x, c.z)).toBe(WORKSHOP_FLOOR_Y);
    expect(groundHeight(c.x + 1, c.z + 1)).toBe(WORKSHOP_FLOOR_Y);
    expect(WORKSHOP_FLOOR_Y).toBeGreaterThan(terrainHeight(c.x, c.z));
    expect(isInsideWorkshop(c.x, c.z)).toBe(true);
    expect(isInsideWorkshop(c.x, c.z + 4)).toBe(false);
  });

  it('宗平・作業台（計画）の位置は変わらず、作業場の判定と重ならない', () => {
    for (const id of ['sohei', 'planTable']) {
      const def = INTERACTABLES.find((i) => i.id === id)!;
      expect(overlapsAny(def.position, 0.35, workshopColliders()), id).toBe(false);
    }
    expect(NPCS.find((n) => n.id === 'sohei')!.position).toEqual({ x: -2.5, z: -23.2 });
  });
});

describe('人物（スキンメッシュ・膝・表情）', () => {
  it('膝は、後ろへ振った脚で大きく、前へ出した脚で少し曲がる', () => {
    expect(kneeBend(0.5, 0)).toBeGreaterThan(kneeBend(-0.5, 0));
    expect(kneeBend(-0.5, 0)).toBeGreaterThan(kneeBend(0, 0));
    expect(kneeBend(0, 0)).toBeGreaterThan(0);
  });

  it('歩くと膝が曲がる（すねの骨が動く）。待機では少しだけ', () => {
    const rig = createPersonRig(PLAYER_APPEARANCE);
    applyPose(rig, walkPose(1.2, 1, true));
    const walking = Math.max(rig.leftShin.rotation.x, rig.rightShin.rotation.x);
    applyPose(rig, idlePose('calm', 0, 0));
    const idle = Math.max(rig.leftShin.rotation.x, rig.rightShin.rotation.x);
    expect(walking).toBeGreaterThan(idle + 0.2);
  });

  it('まばたきは数秒おきに起き、話している間は口が動き、聞いている間は眉が少し上がる', () => {
    const face = new FaceAnimator(0.5);
    let blinked = false;
    let maxMouth = 0;
    for (let i = 0; i < 600; i++) {
      const f = face.update(1 / 60, false, false);
      if (f.blink > 0.5) blinked = true;
      maxMouth = Math.max(maxMouth, f.mouth);
    }
    expect(blinked).toBe(true);
    expect(maxMouth).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) maxMouth = Math.max(maxMouth, face.update(1 / 60, true, true).mouth);
    expect(maxMouth).toBeGreaterThan(0.3);
    let brow = 0;
    for (let i = 0; i < 120; i++) brow = face.update(1 / 60, false, true).brow;
    expect(brow).toBeGreaterThan(0.5);
  });

  it('表情は顔の骨だけを動かす（目を縦に縮める・口を開く・眉を上げる）', () => {
    const rig = createPersonRig(CHARACTERS.sae.appearance);
    applyFace(rig, { blink: 1, mouth: 1, brow: 1 });
    expect(rig.eyes.scale.y).toBeLessThan(0.2);
    expect(rig.mouth.scale.y).toBeGreaterThan(2);
    const raised = rig.brows.position.y;
    applyFace(rig, { blink: 0, mouth: 0, brow: 0 });
    expect(rig.eyes.scale.y).toBe(1);
    expect(raised).toBeGreaterThan(rig.brows.position.y);
  });

  it('人物ごとの違い：宗平は眉がきりっとしていつも少し前かがみ。体格・背丈の倍率は従来どおり', () => {
    expect(CHARACTERS.sohei.appearance.brows).toBe('stern');
    expect(createPersonRig(CHARACTERS.sohei.appearance).stoop).toBeGreaterThan(0);
    const rig = createPersonRig(CHARACTERS.sohei.appearance);
    applyPose(rig, neutralPose());
    expect(rig.torso.rotation.x).toBeCloseTo(CHARACTERS.sohei.appearance.stoop!);
    expect(createPersonRig(CHARACTERS.toki.appearance).root.scale.y).toBeCloseTo(CHARACTERS.toki.appearance.height!);
  });

  it('全員（村の人たちを含む）が作れ、スキンメッシュの骨の数がそろっている', () => {
    const counts = new Set(
      [PLAYER_APPEARANCE, ...Object.values(CHARACTERS).map((ch) => ch.appearance), ...VILLAGER_LOOKS].map(
        (l) => (createPersonRig(l).mesh.skeleton.bones.length),
      ),
    );
    expect(counts.size).toBe(1);
  });
});
