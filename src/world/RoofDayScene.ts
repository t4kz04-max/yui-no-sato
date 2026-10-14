import * as THREE from 'three';
import type { Collider } from '../core/collision';
import { dampAngle, type Vec2 } from '../core/math';
import { Figure } from '../characters/Figure';
import type { PersonAppearance } from '../characters/personRig';
import { CREW_RADIUS, roofDayColliders, type CrewMember, type RoofDayStage } from '../content/staging';
import { createKayaPile, createLadder } from './builders/structures';
import { shadowed, type Palette } from './builders/materials';
import type { ThatchRoof } from './builders/thatch';
import { mergeStaticMeshes } from '../render/mergeStatic';

/**
 * 屋根葺きの日の作業の場（docs/PHASE5_ART.md §4）。
 * 表示する内容は staging.ts の roofDayStage()（計画の結果だけから決まる）に従う。
 * 足場・梯子・茅の山・名前のない村の人たちの作業の動きを描き、その当たり判定を返す。
 */

/** 茅を運ぶ人の往復（茅の山 → 梯子の下 → 茅の山）。 */
interface Carrier {
  readonly member: CrewMember;
  readonly figure: Figure;
  readonly from: Vec2;
  readonly to: Vec2;
  x: number;
  z: number;
  heading: number;
  phase: 'out' | 'drop' | 'back' | 'load';
  timer: number;
  moving: boolean;
}

const CARRY_SPEED = 1.1;
const DROP_TIME = 1.4;
const LOAD_TIME = 1.8;
/** プレイヤーがこれより近いと、運ぶ人は立ち止まって待つ。 */
const YIELD_DISTANCE = 1.2;

export class RoofDayScene {
  readonly root = new THREE.Group();
  /** 動かない物（足場・梯子・茅の山）。作り終えたら結合して描画呼び出しを減らす。 */
  private props = new THREE.Group();
  private figures: Figure[] = [];
  private carriers: Carrier[] = [];
  private staticColliders: Collider[] = [];
  private stage: RoofDayStage | null = null;

  constructor(
    private readonly palette: Palette,
    /** サエ家（建物の位置・向き・縮尺）。 */
    private readonly house: THREE.Object3D,
    private readonly roof: ThatchRoof,
    /** サエ家の南を向いた屋根の面（ローカル ±X）。 */
    private readonly southSide: 1 | -1,
    private readonly looks: readonly PersonAppearance[],
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    this.root.name = 'roof-day';
    this.root.visible = false;
  }

  get current(): RoofDayStage | null {
    return this.stage;
  }

  /** 当日の様子を作り直す（null で片付ける）。 */
  show(stage: RoofDayStage | null): void {
    if (stage?.outcome === this.stage?.outcome) return;
    this.clear();
    this.stage = stage;
    this.root.visible = stage !== null;
    if (!stage) return;
    this.house.updateMatrixWorld(true);
    this.props = new THREE.Group();
    this.root.add(this.props);
    this.buildScaffold(stage);
    for (const pile of stage.piles) {
      const obj = createKayaPile(this.palette, pile.size, pile.fresh);
      obj.position.set(pile.position.x, this.groundHeight(pile.position.x, pile.position.z), pile.position.z);
      this.props.add(obj);
    }
    this.staticColliders = roofDayColliders(stage);
    stage.ladders.forEach((foot) => this.buildLadder(foot));
    mergeStaticMeshes(this.props);
    stage.crew.forEach((m, i) => this.addCrew(m, i));
  }

  /** 当たり判定（茅の山・梯子の足元・地上の人。運ぶ人は今いる場所）。 */
  colliders(): Collider[] {
    return [
      ...this.staticColliders,
      ...this.carriers.map((c) => ({ kind: 'circle' as const, x: c.x, z: c.z, radius: CREW_RADIUS })),
    ];
  }

  /** 作業している村の人の今の位置と役割（近くを通ったときのひと言に使う。Phase 6）。 */
  crewSpots(): Array<{ readonly id: string; readonly role: CrewMember['role']; readonly x: number; readonly y: number; readonly z: number }> {
    const stage = this.stage;
    if (!stage) return [];
    return this.figures.map((f, i) => {
      const m = stage.crew[i]!;
      const p = f.root.position;
      return { id: m.id, role: m.role, x: p.x, y: p.y, z: p.z };
    });
  }

  /** 運ぶ人が動いたか（当たり判定の更新が必要か）を返す。 */
  update(dt: number, player: Vec2): boolean {
    if (!this.stage) return false;
    let moved = false;
    for (const f of this.figures) {
      if (!this.carriers.some((c) => c.figure === f)) f.update(dt);
    }
    for (const c of this.carriers) moved = this.stepCarrier(c, dt, player) || moved;
    return moved;
  }

  private clear(): void {
    // ジオメトリはこの場面だけのものなので捨てる（マテリアルは村・人物で共有しているので残す）
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const child of [...this.root.children]) this.root.remove(child);
    this.figures = [];
    this.carriers = [];
    this.staticColliders = [];
  }

  /** 屋根の南面の点（家のローカル u・v → ワールド座標）。outward：屋根面から外へ離す距離。 */
  private roofPoint(u: number, v: number, outward = 0): THREE.Vector3 {
    const p = this.roof.surfacePoint(this.southSide, u, v);
    const pitch = Math.atan2(this.roof.ridgeY - this.roof.topEaveY, Math.abs(this.roof.surfacePoint(this.southSide, 0, v).x));
    p.x += this.southSide * Math.sin(pitch) * outward;
    p.y += Math.cos(pitch) * outward;
    return p.applyMatrix4(this.house.matrixWorld);
  }

  private pole(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
    const len = a.distanceTo(b);
    const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), material));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.props.add(mesh);
  }

  /** 足場：屋根の南面に沿って横木と縦木を組む（範囲は計画による）。 */
  private buildScaffold(stage: RoofDayStage): void {
    const [v0, v1] = stage.extent === 'full' ? [0.05, 0.95] : [0.1, 0.5];
    const wood = this.palette.woodLight;
    for (const u of [0.1, 0.32, 0.54]) this.pole(this.roofPoint(u, v0, 0.3), this.roofPoint(u, v1, 0.3), 0.06, wood);
    const steps = Math.max(2, Math.round((v1 - v0) / 0.11));
    for (let i = 0; i <= steps; i++) {
      const v = v0 + ((v1 - v0) * i) / steps;
      this.pole(this.roofPoint(0.02, v, 0.25), this.roofPoint(0.62, v, 0.25), 0.05, this.palette.woodWeathered);
    }
    // 屋根の上の人の足場板
    for (const m of stage.crew) {
      if (!m.roofSpot) continue;
      const { u, v } = m.roofSpot;
      this.pole(this.roofPoint(u - 0.03, v - 0.04, 0.42), this.roofPoint(u - 0.03, v + 0.04, 0.42), 0.12, this.palette.woodWeathered);
    }
  }

  private buildLadder(foot: Vec2): void {
    const base = new THREE.Vector3(foot.x, this.groundHeight(foot.x, foot.z), foot.z);
    // 梯子の上端は軒先（足元に最も近い棟方向の位置）にかける
    const local = this.house.worldToLocal(new THREE.Vector3(foot.x, 0, foot.z));
    const v = THREE.MathUtils.clamp((local.z + 8.3) / 16.6, 0, 1);
    const top = this.roofPoint(0.0, v, 0.35);
    top.y += 0.4;
    const dir = top.clone().sub(base);
    const ladder = createLadder(this.palette, dir.length() + 0.3);
    ladder.position.copy(base);
    ladder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.props.add(ladder);
  }

  private addCrew(m: CrewMember, index: number): void {
    const look = this.looks[m.look % this.looks.length]!;
    const style = m.role === 'roof' ? 'tamp' : m.role === 'pass' ? 'pass' : m.role === 'sort' ? 'sort' : 'carry';
    const figure = new Figure(look, style, index * 1.7 + 0.4);
    figure.root.name = `crew:${m.id}`;
    this.figures.push(figure);
    this.root.add(figure.root);
    if (m.role === 'roof' && m.roofSpot) {
      // 屋根の上：足場板の上で、棟の方を向いて茅を叩いて整える
      const p = this.roofPoint(m.roofSpot.u - 0.03, m.roofSpot.v, 0.5);
      figure.root.position.set(p.x, p.y + 0.05, p.z);
      figure.root.rotation.y = this.facingRoof();
      return;
    }
    figure.root.position.set(m.position.x, this.groundHeight(m.position.x, m.position.z), m.position.z);
    figure.root.rotation.y = m.heading;
    if (m.role === 'carry' && m.to) {
      this.carriers.push({
        member: m,
        figure,
        from: m.position,
        to: m.to,
        x: m.position.x,
        z: m.position.z,
        heading: m.heading,
        phase: 'load',
        timer: index * 0.6,
        moving: false,
      });
    }
  }

  /** 屋根の南面に向き合う向き（北）。 */
  private facingRoof(): number {
    const n = new THREE.Vector3(this.southSide, 0, 0).transformDirection(this.house.matrixWorld);
    return Math.atan2(-n.x, -n.z);
  }

  private stepCarrier(c: Carrier, dt: number, player: Vec2): boolean {
    const goal = c.phase === 'out' ? c.to : c.phase === 'back' ? c.from : null;
    let moved = false;
    if (goal) {
      const dx = goal.x - c.x;
      const dz = goal.z - c.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, CARRY_SPEED * dt);
      const nx = c.x + (dx / (dist || 1)) * step;
      const nz = c.z + (dz / (dist || 1)) * step;
      // プレイヤーの近くでは立ち止まる（通り抜け・押し出しが起きないように）
      const blocked = Math.hypot(player.x - nx, player.z - nz) < YIELD_DISTANCE;
      c.moving = !blocked && dist > 0.02;
      if (c.moving) {
        c.x = nx;
        c.z = nz;
        c.heading = dampAngle(c.heading, Math.atan2(dx, dz), 8, dt);
        moved = true;
      }
      if (dist <= 0.02) {
        c.phase = c.phase === 'out' ? 'drop' : 'load';
        c.timer = c.phase === 'drop' ? DROP_TIME : LOAD_TIME;
      }
    } else {
      c.moving = false;
      c.timer -= dt;
      if (c.timer <= 0) c.phase = c.phase === 'drop' ? 'back' : 'out';
    }
    // 運ぶときは担ぎ、戻るときは手ぶら。止まっている間は受け渡し・束そろえ
    c.figure.setStyle(c.phase === 'out' ? 'carry' : c.phase === 'drop' ? 'holdKaya' : c.phase === 'load' ? 'sort' : 'calm');
    c.figure.update(dt, { walking: c.moving ? 0.35 : 0 });
    c.figure.root.position.set(c.x, this.groundHeight(c.x, c.z), c.z);
    c.figure.root.rotation.y = c.heading;
    return moved;
  }
}
