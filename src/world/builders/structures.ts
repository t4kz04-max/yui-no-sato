import * as THREE from 'three';
import { createRandom } from '../../core/random';
import { BUILDING_FOOTPRINT, type PropDef, type PropKind } from '../layout';
import { terrainHeight } from '../terrain';
import { boxWithWorldUv, markCameraBlocker, shadowed, type Palette } from './materials';

/**
 * 合掌造り以外の建物と小物（docs/PHASE5_ART.md §1〜2）。
 * 寸法は layout.ts の BUILDING_FOOTPRINT・PROP_FOOTPRINT（当たり判定）の内側に収める。
 */

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => shadowed(new THREE.Mesh(geo, m), cast);
const at = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T => {
  obj.position.set(x, y, z);
  return obj;
};

/** 切妻の板屋根（作業場・小屋用）。板の継ぎ目の桟を並べる。 */
function gableBoardRoof(p: Palette, halfSpan: number, halfDepth: number, pitchDeg: number): THREE.Group {
  const g = new THREE.Group();
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const slope = halfSpan / Math.cos(pitch);
  const geo = boxWithWorldUv(slope, 0.16, halfDepth * 2, 1.2);
  const battenGeo = new THREE.BoxGeometry(slope, 0.08, 0.1);
  for (const side of [1, -1]) {
    const panel = mesh(geo, p.woodWeathered);
    panel.position.set((side * halfSpan) / 2, (Math.tan(pitch) * halfSpan) / 2, 0);
    panel.rotation.z = -side * pitch;
    markCameraBlocker(panel);
    g.add(panel);
    for (let z = -halfDepth + 0.3; z <= halfDepth - 0.2; z += 0.9) {
      const batten = mesh(battenGeo, p.woodDark, false);
      batten.position.set((side * halfSpan) / 2 + side * 0.07 * Math.sin(pitch), (Math.tan(pitch) * halfSpan) / 2 + 0.1, z);
      batten.rotation.z = -side * pitch;
      g.add(batten);
    }
  }
  const ridge = mesh(new THREE.BoxGeometry(0.3, 0.2, halfDepth * 2 + 0.1), p.woodDark, false);
  ridge.position.y = Math.tan(pitch) * halfSpan + 0.05;
  g.add(ridge);
  return g;
}

/** 茅の束（円柱）を積み上げる。 */
function kayaStack(p: Palette, columns: number, rows: number, length: number, freshShare = 0.5): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.26, 0.3, length, 8);
  const tie = new THREE.CylinderGeometry(0.31, 0.31, 0.1, 8);
  const rand = createRandom(columns * 31 + rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns - (r % 2); c++) {
      const fresh = rand() < freshShare;
      const z = (c - (columns - 1) / 2 + (r % 2) * 0.5) * 0.56;
      const bundle = mesh(geo, fresh ? p.thatchFresh : p.thatch);
      bundle.rotation.z = Math.PI / 2;
      bundle.position.set((rand() - 0.5) * 0.25, 0.3 + r * 0.48, z);
      g.add(bundle);
      for (const x of [-length * 0.25, length * 0.25]) {
        const band = mesh(tie, p.rope, false);
        band.rotation.z = Math.PI / 2;
        band.position.set(bundle.position.x + x, bundle.position.y, z);
        g.add(band);
      }
    }
  }
  return g;
}

/** 宗平の作業場：板壁の作業小屋。正面は大きな開口で、中に材木と道具が見える。 */
export function createWorkshop(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'workshop';
  const fp = BUILDING_FOOTPRINT.workshop;
  const wallH = 3;
  const w = fp.halfWidth * 2 - 0.4;
  const d = fp.halfDepth * 2 - 0.4;

  g.add(at(mesh(new THREE.BoxGeometry(fp.halfWidth * 2, 1.2, fp.halfDepth * 2), p.stone), 0, -0.4, 0));
  // 奥と両脇の壁（正面は開けておく）
  const back = mesh(boxWithWorldUv(w, wallH, 0.2, 1.4), p.woodWall);
  markCameraBlocker(back);
  g.add(at(back, 0, 0.2 + wallH / 2, -d / 2 + 0.1));
  for (const side of [1, -1]) {
    const wall = mesh(boxWithWorldUv(0.2, wallH, d, 1.4), p.woodWall);
    markCameraBlocker(wall);
    g.add(at(wall, side * (w / 2 - 0.1), 0.2 + wallH / 2, 0));
  }
  // 正面の壁（入口の両脇だけ）と柱・鴨居
  for (const side of [1, -1]) {
    const part = mesh(boxWithWorldUv(1.6, wallH, 0.2, 1.4), p.woodWall);
    markCameraBlocker(part);
    g.add(at(part, side * (w / 2 - 0.8), 0.2 + wallH / 2, d / 2 - 0.1));
  }
  g.add(at(mesh(new THREE.BoxGeometry(w + 0.2, 0.3, 0.3), p.woodDark, false), 0, 0.2 + wallH - 0.1, d / 2));
  for (const x of [-w / 2, -w / 2 + 1.6, w / 2 - 1.6, w / 2]) {
    g.add(at(mesh(new THREE.BoxGeometry(0.26, wallH, 0.26), p.woodDark, false), x, 0.2 + wallH / 2, d / 2));
  }
  // 床と、中の材木・作業台
  g.add(at(mesh(new THREE.BoxGeometry(w - 0.4, 0.1, d - 0.4), p.woodWeathered, false), 0, 0.22, 0));
  const lumberGeo = new THREE.BoxGeometry(3.4, 0.16, 0.16);
  for (let i = 0; i < 9; i++) {
    g.add(at(mesh(lumberGeo, i % 3 === 0 ? p.woodWeathered : p.woodLight, false), -0.6, 0.4 + Math.floor(i / 3) * 0.17, -d / 2 + 0.5 + (i % 3) * 0.18));
  }
  const bench = mesh(new THREE.BoxGeometry(1.8, 0.12, 0.7), p.woodLight, false);
  g.add(at(bench, 2.0, 0.95, -0.6));
  for (const x of [1.3, 2.7]) g.add(at(mesh(new THREE.BoxGeometry(0.12, 0.75, 0.6), p.woodDark, false), x, 0.55, -0.6));
  // 壁の小窓（格子）
  for (const side of [1, -1]) {
    const frame = mesh(new THREE.BoxGeometry(0.1, 0.8, 1.4), p.woodDark, false);
    g.add(at(frame, side * (w / 2 + 0.02), 2.0, 0));
    for (let k = -2; k <= 2; k++) g.add(at(mesh(new THREE.BoxGeometry(0.12, 0.7, 0.05), p.woodLight, false), side * (w / 2 + 0.04), 2.0, k * 0.25));
  }

  const roof = gableBoardRoof(p, fp.halfWidth + 0.6, fp.halfDepth + 0.7, 28);
  roof.position.y = 0.2 + wallH;
  g.add(roof);
  // 妻壁
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0);
  tri.lineTo(0, Math.tan(THREE.MathUtils.degToRad(28)) * (w / 2));
  tri.lineTo(w / 2, 0);
  tri.closePath();
  for (const side of [1, -1]) {
    const gable = mesh(new THREE.ShapeGeometry(tri), p.woodWall, false);
    gable.position.set(0, 0.2 + wallH, side * (d / 2 - 0.02));
    if (side < 0) gable.rotation.y = Math.PI;
    g.add(gable);
  }

  // 正面に立てかけた材木
  const leanGeo = new THREE.BoxGeometry(0.2, 3.2, 0.12);
  for (let i = 0; i < 5; i++) {
    const lumber = mesh(leanGeo, i % 2 ? p.woodLight : p.woodWeathered);
    lumber.position.set(-fp.halfWidth + 0.5 + i * 0.26, 1.6, fp.halfDepth - 0.05);
    lumber.rotation.x = -0.22;
    g.add(lumber);
  }
  return g;
}

/** ミネ家の茅置場：柱と屋根だけの小屋に茅を保管する。 */
export function createKayaShed(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'kayaShed';
  const fp = BUILDING_FOOTPRINT.kayaShed;
  const postH = 2.8;
  const postGeo = new THREE.BoxGeometry(0.25, postH + 1, 0.25);
  for (const x of [-fp.halfWidth + 0.2, 0, fp.halfWidth - 0.2]) {
    for (const z of [-fp.halfDepth + 0.2, fp.halfDepth - 0.2]) {
      g.add(at(mesh(postGeo, p.woodDark), x, postH / 2 - 0.5, z));
    }
  }
  // 貫（柱をつなぐ横木）
  for (const z of [-fp.halfDepth + 0.2, fp.halfDepth - 0.2]) {
    g.add(at(mesh(new THREE.BoxGeometry(fp.halfWidth * 2 - 0.2, 0.14, 0.14), p.woodDark, false), 0, postH - 0.2, z));
  }
  const roof = gableBoardRoof(p, fp.halfDepth + 0.5, fp.halfWidth + 0.5, 35);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = postH;
  g.add(roof);
  // すのこ（地面から茅を離す）
  g.add(at(mesh(new THREE.BoxGeometry(fp.halfWidth * 2 - 0.6, 0.12, fp.halfDepth * 2 - 0.6), p.woodWeathered, false), 0, 0.06, 0));
  g.add(kayaStack(p, 7, 4, fp.halfWidth * 2 - 0.8, 0.35));
  return g;
}

/** 伊助家の農具小屋：板壁・板屋根の小さな小屋。正面の軒下に農具を立てかける。 */
export function createToolShed(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'toolShed';
  const fp = BUILDING_FOOTPRINT.toolShed;
  const w = fp.halfWidth * 2 - 0.4;
  const d = fp.halfDepth * 2 - 0.5;
  const h = 2.3;
  g.add(at(mesh(new THREE.BoxGeometry(w + 0.2, 0.8, d + 0.2), p.stone), 0, -0.25, 0));
  const body = mesh(boxWithWorldUv(w, h, d, 1.4), p.woodWall);
  markCameraBlocker(body);
  g.add(at(body, 0, 0.15 + h / 2, 0));
  g.add(at(mesh(new THREE.BoxGeometry(1.3, 1.9, 0.1), p.woodWeathered, false), 0, 1.1, d / 2 + 0.04));
  const roof = gableBoardRoof(p, w / 2 + 0.45, d / 2 + 0.4, 30);
  roof.position.y = 0.15 + h;
  g.add(roof);
  return g;
}

/**
 * 刈り入れが済んだときに、はさ掛けの空いている段に足す稲の束（表示の切り替え用に結合しない）。
 * createProp の hasaRack と同じ並びで、上下の段を入れ替えた位置に置く。
 */
export function createHarvestExtra(p: Palette, racks: readonly PropDef[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'harvest-extra';
  const sheafGeo = sheafGeometry();
  for (const rack of racks) {
    const g = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      g.add(at(mesh(sheafGeo, p.crop), -2.8 + i * 0.37, i % 2 === 0 ? 1.55 : 0.85, 0.04));
    }
    g.position.set(rack.position.x, terrainHeight(rack.position.x, rack.position.z), rack.position.z);
    g.rotation.y = rack.rotation;
    g.scale.setScalar(rack.scale ?? 1);
    group.add(g);
  }
  return group;
}

/** はさ掛けに掛けた稲の束（上で縛って二つに分けた形）。 */
function sheafGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.1, 0.24, 0.95, 6);
}

/** 小物。寸法は layout.ts の PROP_FOOTPRINT と対応する。 */
export function createProp(p: Palette, kind: PropKind): THREE.Object3D {
  switch (kind) {
    case 'woodpile': {
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 7);
      const rand = createRandom(5);
      for (let i = 0; i < 18; i++) {
        const log = mesh(geo, i % 4 === 0 ? p.woodLight : p.woodWeathered);
        log.rotation.z = Math.PI / 2;
        log.position.set((rand() - 0.5) * 0.15, 0.18 + Math.floor(i / 5) * 0.32, ((i % 5) - 2) * 0.19 + (Math.floor(i / 5) % 2) * 0.09);
        g.add(log);
      }
      // 雨よけの板
      const cover = mesh(new THREE.BoxGeometry(2.6, 0.08, 0.95), p.woodWeathered);
      cover.position.y = 1.45;
      cover.rotation.x = 0.12;
      g.add(cover);
      return g;
    }
    case 'lantern': {
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), p.stone), 0, 0.15, 0));
      g.add(at(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6), p.stone), 0, 0.75, 0));
      g.add(at(mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), p.stone), 0, 1.24, 0));
      g.add(at(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), p.stone), 0, 1.5, 0));
      // 火袋の窓
      for (const r of [0, Math.PI / 2]) {
        const hole = mesh(new THREE.BoxGeometry(0.52, 0.2, 0.2), p.woodDark, false);
        hole.position.y = 1.52;
        hole.rotation.y = r;
        g.add(hole);
      }
      const top = mesh(new THREE.ConeGeometry(0.62, 0.45, 4), p.stone);
      top.position.y = 1.92;
      top.rotation.y = Math.PI / 4;
      g.add(top);
      g.add(at(mesh(new THREE.SphereGeometry(0.1, 6, 4), p.stone), 0, 2.18, 0));
      return g;
    }
    case 'kayaBundles':
      return kayaStack(p, 3, 3, 3.0, 0.6);
    case 'hasaRack': {
      // はさ掛け：刈った稲を干す木組み
      const g = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 2.5, 5);
      for (const x of [-3, -1, 1, 3]) {
        g.add(at(mesh(postGeo, p.woodWeathered), x, 1.15, 0));
        // 支えの斜めの棒
        const brace = mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 5), p.woodWeathered, false);
        brace.position.set(x, 1.0, 0.45);
        brace.rotation.x = -0.45;
        g.add(brace);
      }
      const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 6.4, 5);
      for (const y of [1.2, 1.9]) {
        const bar = mesh(barGeo, p.woodWeathered, false);
        bar.rotation.z = Math.PI / 2;
        bar.position.y = y;
        g.add(bar);
      }
      const sheafGeo = sheafGeometry();
      for (let i = 0; i < 16; i++) {
        g.add(at(mesh(sheafGeo, p.crop), -2.8 + i * 0.37, i % 2 === 0 ? 0.85 : 1.55, 0));
      }
      return g;
    }
    case 'workbench': {
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.BoxGeometry(2.4, 0.15, 1.2), p.woodLight), 0, 0.9, 0));
      const legGeo = new THREE.BoxGeometry(0.14, 0.85, 0.14);
      for (const x of [-1.05, 1.05]) {
        for (const z of [-0.45, 0.45]) g.add(at(mesh(legGeo, p.woodDark, false), x, 0.42, z));
      }
      // 台の上の図面（計画を広げる場所であることが分かるように）と墨壺・縄
      const sheet = mesh(new THREE.BoxGeometry(1.0, 0.02, 0.7), p.plaster, false);
      sheet.position.set(-0.2, 0.985, 0);
      sheet.rotation.y = 0.12;
      g.add(sheet);
      g.add(at(mesh(new THREE.BoxGeometry(0.22, 0.12, 0.14), p.woodDark, false), 0.75, 1.03, -0.2));
      g.add(at(mesh(new THREE.TorusGeometry(0.18, 0.05, 5, 10).rotateX(Math.PI / 2), p.rope, false), 0.7, 1.0, 0.3));
      return g;
    }
    case 'ledgerBox': {
      // 縁先の低い台と文箱、その上の帳面（結帳）
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.BoxGeometry(0.9, 0.08, 0.6), p.woodLight), 0, 0.55, 0));
      const legGeo = new THREE.BoxGeometry(0.08, 0.55, 0.08);
      for (const x of [-0.38, 0.38]) {
        for (const z of [-0.24, 0.24]) g.add(at(mesh(legGeo, p.woodDark, false), x, 0.27, z));
      }
      g.add(at(mesh(new THREE.BoxGeometry(0.5, 0.16, 0.36), p.woodDark), -0.12, 0.67, 0));
      const book = mesh(new THREE.BoxGeometry(0.3, 0.05, 0.22), p.plaster);
      book.position.set(0.24, 0.62, 0.05);
      book.rotation.y = 0.2;
      g.add(book);
      return g;
    }
    case 'recordShelf': {
      // 小さな棚と帳面（ミネ家の貸し借りの控え）
      const g = new THREE.Group();
      const sideGeo = new THREE.BoxGeometry(0.06, 1.3, 0.45);
      for (const x of [-0.52, 0.52]) g.add(at(mesh(sideGeo, p.woodWeathered), x, 0.65, 0));
      const shelfGeo = new THREE.BoxGeometry(1.04, 0.05, 0.45);
      for (const y of [0.1, 0.55, 1.0, 1.3]) g.add(at(mesh(shelfGeo, p.woodWeathered, false), 0, y, 0));
      const bookGeo = new THREE.BoxGeometry(0.28, 0.06, 0.2);
      for (let i = 0; i < 3; i++) g.add(at(mesh(bookGeo, p.plaster, false), -0.25 + i * 0.25, 0.6 + (i % 2) * 0.05, 0.05));
      // 小さな屋根（雨よけ）
      const cap = mesh(new THREE.BoxGeometry(1.2, 0.06, 0.65), p.woodDark);
      cap.position.set(0, 1.42, 0.05);
      cap.rotation.x = 0.15;
      g.add(cap);
      return g;
    }
    case 'rock': {
      const rock = mesh(new THREE.DodecahedronGeometry(0.75, 0), p.rock);
      rock.scale.set(1, 0.6, 0.85);
      rock.position.y = 0.2;
      return rock;
    }
    case 'tub': {
      // 水を張った木の桶
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.55, 12, 1, true), p.woodLight), 0, 0.28, 0));
      g.add(at(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12), p.woodDark, false), 0, 0.04, 0));
      g.add(at(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 12), p.water, false), 0, 0.45, 0));
      for (const y of [0.12, 0.44]) {
        g.add(at(mesh(new THREE.TorusGeometry(0.4 - y * 0.08, 0.025, 4, 14).rotateX(Math.PI / 2), p.rope, false), 0, y, 0));
      }
      return g;
    }
    case 'basket': {
      // 背負い籠
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.CylinderGeometry(0.32, 0.22, 0.7, 10, 1, true), p.rope), 0, 0.35, 0));
      g.add(at(mesh(new THREE.TorusGeometry(0.32, 0.03, 4, 12).rotateX(Math.PI / 2), p.woodWeathered, false), 0, 0.7, 0));
      return g;
    }
    case 'toolRack': {
      // 横木に立てかけた農具（鍬・鋤・熊手の柄）
      const g = new THREE.Group();
      for (const x of [-0.8, 0.8]) g.add(at(mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), p.woodDark), x, 0.65, -0.2));
      g.add(at(mesh(new THREE.BoxGeometry(1.8, 0.08, 0.08), p.woodDark, false), 0, 1.2, -0.2));
      const rand = createRandom(17);
      for (let i = 0; i < 5; i++) {
        const tool = new THREE.Group();
        tool.add(at(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), p.woodLight), 0, 0.75, 0));
        tool.add(at(mesh(new THREE.BoxGeometry(0.22, 0.24, 0.03), p.iron, false), 0, 0.12, 0.04));
        tool.position.set(-0.6 + i * 0.3, 0, 0.05);
        tool.rotation.x = -0.18 - rand() * 0.06;
        g.add(tool);
      }
      return g;
    }
    case 'ladderRack': {
      // 壁に立てかけた梯子（屋根葺きの道具）
      const g = new THREE.Group();
      for (const [x, len] of [
        [-0.8, 4.2],
        [0.7, 3.6],
      ] as const) {
        const ladder = createLadder(p, len);
        ladder.position.set(x, 0, 0.1);
        ladder.rotation.x = -0.2;
        g.add(ladder);
      }
      return g;
    }
    case 'ropeCoil': {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        g.add(at(mesh(new THREE.TorusGeometry(0.3, 0.06, 5, 14).rotateX(Math.PI / 2), p.rope), 0, 0.06 + i * 0.1, 0));
      }
      return g;
    }
  }
}

/** 梯子（足元が原点、+Y に伸びる）。屋根葺きの日にも使う。 */
export function createLadder(p: Palette, length: number): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.25, 0.25]) g.add(at(mesh(new THREE.BoxGeometry(0.08, length, 0.08), p.woodLight), x, length / 2, 0));
  for (let y = 0.35; y < length - 0.1; y += 0.4) g.add(at(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), p.woodLight, false), 0, y, 0));
  return g;
}

/** 茅の山（屋根葺きの日）。large：ミネから借りた茅も積んだ大きな山。 */
export function createKayaPile(p: Palette, size: 'large' | 'small', fresh: boolean): THREE.Group {
  return size === 'large' ? kayaStack(p, 3, 4, 2.4, fresh ? 0.95 : 0.4) : kayaStack(p, 3, 2, 2.2, fresh ? 0.9 : 0.35);
}
