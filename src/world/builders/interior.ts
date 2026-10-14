import * as THREE from 'three';
import { SAE_INTERIOR } from '../saeInterior';
import { boxWithWorldUv, markCameraBlocker, shadowed, type Palette } from './materials';
import { createProp } from './structures';

/**
 * サエ家の室内（Phase 5.5、docs/PHASE5_5_PLAN.md §1〜2）。ワールド座標で作り、床の高さ floorY に置く。
 *
 * 資料で確認できた構成だけを、白川郷の家の一般的な特徴として扱う：
 * 入口の土間、中央の囲炉裏のある板の間、囲炉裏の上の火天（ひあま）、居間の上の格子の天井、
 * 屋根裏へ上がる急な階段、奥の部屋（ここでは閉じた襖の向こう）。
 * 結帳の棚・囲炉裏の鍋・物置きの道具の置き方は、ゲーム用の創作。
 *
 * 屋内にいるときだけ表示する（屋外の描画負荷を増やさない）。
 */
export interface SaeInterior {
  readonly root: THREE.Group;
  /** 囲炉裏の火と、障子からの明るさ（屋外では 0 にする）。 */
  readonly lights: readonly THREE.Light[];
  /** 屋内のカメラの遮蔽物（天井・間仕切り・柱）。外壁は家の側にある。 */
  readonly cameraBlockers: readonly THREE.Object3D[];
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

export function createSaeInterior(p: Palette, floorY: number): SaeInterior {
  const root = new THREE.Group();
  root.name = 'sae-interior';
  const blockers: THREE.Object3D[] = [];
  const I = SAE_INTERIOR;
  const b = I.bounds;
  const H = I.ceiling;
  const add = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T => {
    obj.position.set(x, floorY + y, z);
    root.add(obj);
    return obj;
  };
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, cast = false) => shadowed(new THREE.Mesh(geo, m), cast, true);

  const earth = mat(0xa08a6a);
  const boards = mat(0xc49a68, { map: p.woodWall.map });
  const sooty = mat(0x2a1f18);
  const ash = mat(0xb4b0a8);
  const ember = new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff5a10, emissiveIntensity: 1.6 });
  const paper = mat(0xffffff, { map: p.shoji.map, emissive: 0x4a3a24, emissiveIntensity: 0.55 });
  const fusuma = mat(0xd8cfb8);

  // ── 床：南は土間、北は板の間（境に上がり框） ──
  const w = b.maxX - b.minX;
  const doma = add(mesh(new THREE.BoxGeometry(w, 0.1, b.maxZ - I.domaZ), earth), (b.minX + b.maxX) / 2, -0.035, (I.domaZ + b.maxZ) / 2);
  doma.name = 'doma';
  const oeFloor = add(mesh(boxWithWorldUv(w, 0.1, I.domaZ - b.minZ, 1.2), boards), (b.minX + b.maxX) / 2, -0.03, (b.minZ + I.domaZ) / 2);
  oeFloor.name = 'oe-floor';
  add(mesh(new THREE.BoxGeometry(I.partitionX - b.minX, 0.16, 0.18), p.woodDark), (b.minX + I.partitionX) / 2, 0.02, I.domaZ);

  // ── 天井：梁と、格子（簀子）の天井。隙間から上の暗がりが見える ──
  const ceilingBack = add(mesh(new THREE.BoxGeometry(w, 0.08, b.maxZ - b.minZ), sooty), (b.minX + b.maxX) / 2, H + 0.25, 0);
  markCameraBlocker(ceilingBack);
  blockers.push(ceilingBack);
  for (let x = b.minX + 0.12; x < b.maxX; x += 0.3) {
    add(mesh(new THREE.BoxGeometry(0.12, 0.05, b.maxZ - b.minZ), p.woodLight), x, H + 0.15, 0);
  }
  for (const z of [I.domaZ, -1.6, b.minZ + 0.3]) {
    add(mesh(new THREE.BoxGeometry(w, 0.32, 0.26), p.woodDark), (b.minX + b.maxX) / 2, H, z);
  }
  for (const x of [I.oeWestX, I.partitionX]) {
    add(mesh(new THREE.BoxGeometry(0.26, 0.3, b.maxZ - b.minZ), p.woodDark), x, H - 0.02, 0);
  }

  // ── 柱 ──
  for (const post of I.posts) {
    const pillar = add(mesh(new THREE.BoxGeometry(0.34, H, 0.34), p.woodDark, true), post.x, H / 2, post.z);
    markCameraBlocker(pillar);
    blockers.push(pillar);
  }

  // ── 外壁の内側：障子（外の明るさ）と、入口の戸 ──
  const pane = (x: number, z: number, rotY: number, width: number) => {
    const frame = add(mesh(new THREE.BoxGeometry(width + 0.12, 1.3, 0.06), p.woodDark), x, 1.55, z);
    frame.rotation.y = rotY;
    const glow = add(mesh(new THREE.BoxGeometry(width, 1.15, 0.04), paper), x, 1.55, z);
    glow.rotation.y = rotY;
    glow.position.add(new THREE.Vector3(0, 0, 0.03).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
  };
  for (const x of [-6.6, -4.4, 4.4, 6.6]) pane(x, b.maxZ - 0.02, Math.PI, 1.6);
  for (const x of [-6.0, -2.0, 2.0]) pane(x, b.minZ + 0.02, 0, 1.4);
  // 入口の戸（閉じている。ここで E を押すと外に出る）
  add(mesh(new THREE.BoxGeometry(2.3, 2.5, 0.08), p.woodDark), I.door.x, 1.25, b.maxZ - 0.02);
  add(mesh(new THREE.BoxGeometry(1.0, 2.3, 0.06), p.woodLight), I.door.x - 0.5, 1.2, b.maxZ - 0.07);
  add(mesh(new THREE.BoxGeometry(1.0, 2.3, 0.06), paper), I.door.x + 0.5, 1.2, b.maxZ - 0.07);

  // ── 奥の部屋との間仕切り：板の間側は襖、土間側は板壁 ──
  const partD = I.domaZ - b.minZ;
  const fus = add(mesh(new THREE.BoxGeometry(0.1, H, partD), fusuma), I.partitionX, H / 2, (b.minZ + I.domaZ) / 2);
  markCameraBlocker(fus);
  blockers.push(fus);
  for (let z = b.minZ + partD / 4; z < I.domaZ - 0.1; z += partD / 4) {
    add(mesh(new THREE.BoxGeometry(0.14, H, 0.06), p.woodDark), I.partitionX - 0.02, H / 2, z);
  }
  add(mesh(new THREE.BoxGeometry(0.14, 0.1, partD), p.woodDark), I.partitionX - 0.02, 2.0, (b.minZ + I.domaZ) / 2);
  const domaWall = add(mesh(boxWithWorldUv(0.12, H, b.maxZ - I.domaZ, 1.4), p.woodWall), I.partitionX, H / 2, (I.domaZ + b.maxZ) / 2);
  markCameraBlocker(domaWall);
  blockers.push(domaWall);

  // ── 囲炉裏と火天 ──
  const ir = I.irori;
  const hearth = new THREE.Group();
  const s = ir.half * 2;
  for (const [dx, dz, ww, dd] of [
    [0, -ir.half + 0.08, s, 0.16],
    [0, ir.half - 0.08, s, 0.16],
    [-ir.half + 0.08, 0, 0.16, s],
    [ir.half - 0.08, 0, 0.16, s],
  ] as const) {
    const rim = mesh(new THREE.BoxGeometry(ww, 0.12, dd), p.woodLight);
    rim.position.set(dx, 0.04, dz);
    hearth.add(rim);
  }
  const ashBed = mesh(new THREE.BoxGeometry(s - 0.3, 0.04, s - 0.3), ash);
  ashBed.position.y = -0.02;
  hearth.add(ashBed);
  for (let k = 0; k < 5; k++) {
    const e = mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), k % 2 ? ember : sooty);
    e.position.set(Math.cos(k * 1.3) * 0.12, 0.03, Math.sin(k * 1.3) * 0.12);
    e.rotation.y = k * 0.7;
    hearth.add(e);
  }
  // 鍋を吊るす（形はゲーム用の簡略）
  const hook = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5), p.woodDark);
  hook.position.y = 1.35;
  hearth.add(hook);
  const pot = mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), p.iron, true);
  pot.position.y = 0.7;
  hearth.add(pot);
  add(hearth, ir.x, 0, ir.z);
  // 火天：煤で黒い吊り板（火の粉を止める）
  const hiama = add(mesh(new THREE.BoxGeometry(1.7, 0.06, 1.7), sooty, true), ir.x, 2.25, ir.z);
  hiama.name = 'hiama';
  for (const [dx, dz] of [
    [-0.75, -0.75],
    [0.75, -0.75],
    [-0.75, 0.75],
    [0.75, 0.75],
  ] as const) {
    add(mesh(new THREE.CylinderGeometry(0.02, 0.02, H - 2.25, 4), p.rope), ir.x + dx, (H + 2.25) / 2, ir.z + dz);
  }
  // 囲炉裏の周りの敷物（座る場所）
  for (const [dx, dz, ww, dd] of [
    [0, ir.half + 0.45, 1.4, 0.6],
    [-ir.half - 0.45, 0, 0.6, 1.4],
    [ir.half + 0.45, 0, 0.6, 1.4],
  ] as const) {
    add(mesh(new THREE.BoxGeometry(ww, 0.02, dd), mat(0x9a8a5a)), ir.x + dx, 0.02, ir.z + dz);
  }

  // ── 結帳の棚（北の壁際）──
  const sh = I.ledgerShelf;
  const chest = add(mesh(boxWithWorldUv(sh.halfWidth * 2, 0.55, sh.halfDepth * 2, 1.2), p.woodLight, true), sh.x, 0.275, sh.z);
  chest.name = 'ledger-chest';
  add(mesh(new THREE.BoxGeometry(sh.halfWidth * 2 - 0.1, 0.04, 0.03), p.woodDark), sh.x, 0.3, sh.z + sh.halfDepth + 0.01);
  const box = add(mesh(new THREE.BoxGeometry(0.5, 0.16, 0.36), p.woodDark, true), sh.x - 0.15, 0.63, sh.z);
  box.name = 'ledger-box';
  const book = add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.22), p.plaster, true), sh.x + 0.28, 0.58, sh.z + 0.05);
  book.rotation.y = 0.2;
  // 壁の棚（器）
  add(mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), p.woodLight), sh.x - 0.2, 1.6, b.minZ + 0.18);
  for (let k = 0; k < 4; k++) {
    add(mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.1, 8), mat(k % 2 ? 0x8a5a3a : 0x5a4a3a)), sh.x - 0.7 + k * 0.32, 1.68, b.minZ + 0.18);
  }

  // ── 屋根裏へ上がる急な階段（飾り。天井の開口へ） ──
  const st = I.stairs;
  const steps = 9;
  for (let k = 0; k < steps; k++) {
    const y = 0.2 + (k * (H - 0.3)) / steps;
    const z = st.z + st.halfDepth - 0.1 - (k * (st.halfDepth * 2 - 0.2)) / (steps - 1);
    add(mesh(new THREE.BoxGeometry(st.halfWidth * 2 - 0.1, 0.06, 0.22), p.woodLight, true), st.x, y, z);
  }
  for (const dx of [-st.halfWidth + 0.04, st.halfWidth - 0.04]) {
    const rail = add(mesh(new THREE.BoxGeometry(0.08, 0.1, Math.hypot(H, st.halfDepth * 2)), p.woodDark), st.x + dx, H / 2, st.z);
    rail.rotation.x = Math.atan2(H, st.halfDepth * 2);
  }
  add(mesh(new THREE.BoxGeometry(st.halfWidth * 2 + 0.2, 0.06, 1.0), mat(0x0a0806)), st.x, H + 0.12, st.z - st.halfDepth + 0.3);

  // ── 物置き：薪・茅の束・水がめ・かご ──
  for (const o of I.storage) {
    if (o.kind === 'woodpile') {
      const pile = createProp(p, 'woodpile');
      pile.rotation.y = Math.PI / 2;
      add(pile, o.x, 0, o.z);
    } else if (o.kind === 'kaya') {
      const k = createProp(p, 'kayaBundles');
      k.rotation.y = Math.PI / 2;
      k.scale.setScalar(0.6);
      add(k, o.x, 0, o.z);
    } else if (o.kind === 'jar') {
      add(mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.8, 12), mat(0x4a3a30), true), o.x, 0.4, o.z);
      add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), p.woodLight), o.x, 0.82, o.z);
    } else {
      add(createProp(p, 'basket'), o.x, 0, o.z);
    }
  }
  // 土間の壁際の農具
  const rack = createProp(p, 'toolRack');
  rack.rotation.y = Math.PI;
  add(rack, -2.2, 0, b.maxZ - 0.35);

  // ── 明かり：囲炉裏の火（暖かい）と、障子からの明るさ（やわらかい） ──
  const fire = new THREE.PointLight(0xff9a50, 0, 10, 1.5);
  fire.position.set(ir.x, floorY + 0.9, ir.z);
  root.add(fire);

  root.visible = false;
  return { root, lights: [fire], cameraBlockers: blockers };
}

/** 屋内に入ったときの明かりの強さ（囲炉裏の火）。 */
export const INTERIOR_LIGHT_INTENSITY = [14] as const;
/**
 * 屋内では、屋根と壁の影で日が差さないので、空の光（屋外と共用の HemisphereLight）を強める。
 * 明かりを足すと屋外でも毎回計算されて重くなるため、強さの切り替えだけで済ませる。
 */
export const INDOOR_SKY_LIGHT_SCALE = 2.6;
