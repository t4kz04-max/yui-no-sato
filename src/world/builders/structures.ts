import * as THREE from 'three';
import { BUILDING_FOOTPRINT, type PropKind } from '../layout';
import { markCameraBlocker, shadowed, type Palette } from './materials';

/** 切妻の板屋根（作業場・小屋用）。 */
function gableBoardRoof(p: Palette, halfSpan: number, halfDepth: number, pitchDeg: number): THREE.Group {
  const g = new THREE.Group();
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const slope = halfSpan / Math.cos(pitch);
  const geo = new THREE.BoxGeometry(slope, 0.18, halfDepth * 2);
  for (const side of [1, -1]) {
    const panel = shadowed(new THREE.Mesh(geo, p.woodWeathered));
    panel.position.set((side * halfSpan) / 2, (Math.tan(pitch) * halfSpan) / 2, 0);
    panel.rotation.z = -side * pitch;
    markCameraBlocker(panel);
    g.add(panel);
  }
  return g;
}

/** 宗平の作業場（仮モデル）：板壁の作業小屋。 */
export function createWorkshop(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'workshop';
  const fp = BUILDING_FOOTPRINT.workshop;
  const wallH = 3;

  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(fp.halfWidth * 2, 1.2, fp.halfDepth * 2), p.stone));
  base.position.y = -0.4;
  g.add(base);

  const body = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(fp.halfWidth * 2 - 0.4, wallH, fp.halfDepth * 2 - 0.4), p.woodLight),
  );
  body.position.y = 0.2 + wallH / 2;
  markCameraBlocker(body);
  g.add(body);

  // 開口部（大きな引き戸）
  const opening = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 0.1), p.woodDark);
  opening.position.set(0, 1.4, fp.halfDepth - 0.18);
  g.add(opening);

  const roof = gableBoardRoof(p, fp.halfWidth + 0.6, fp.halfDepth + 0.6, 28);
  roof.position.y = 0.2 + wallH;
  g.add(roof);

  // 立てかけた材木
  const lumberGeo = new THREE.BoxGeometry(0.2, 3.2, 0.12);
  for (let i = 0; i < 6; i++) {
    const lumber = shadowed(new THREE.Mesh(lumberGeo, p.woodLight));
    lumber.position.set(-fp.halfWidth + 0.5 + i * 0.28, 1.6, fp.halfDepth + 0.1);
    lumber.rotation.x = -0.25;
    g.add(lumber);
  }
  return g;
}

/** 茅の束（円柱）を積み上げる。 */
function kayaStack(p: Palette, columns: number, rows: number, length: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.28, 0.32, length, 8);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns - (r % 2); c++) {
      const bundle = shadowed(new THREE.Mesh(geo, r % 2 === 0 ? p.thatchFresh : p.thatch));
      bundle.rotation.z = Math.PI / 2;
      bundle.position.set(0, 0.3 + r * 0.5, (c - (columns - 1) / 2 + (r % 2) * 0.5) * 0.58);
      g.add(bundle);
    }
  }
  return g;
}

/** ミネ家の茅置場（仮モデル）：柱と屋根だけの小屋に茅を保管する。 */
export function createKayaShed(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'kayaShed';
  const fp = BUILDING_FOOTPRINT.kayaShed;
  const postH = 2.8;
  const postGeo = new THREE.BoxGeometry(0.25, postH + 1, 0.25);
  for (const x of [-fp.halfWidth + 0.2, 0, fp.halfWidth - 0.2]) {
    for (const z of [-fp.halfDepth + 0.2, fp.halfDepth - 0.2]) {
      const post = shadowed(new THREE.Mesh(postGeo, p.woodDark));
      post.position.set(x, postH / 2 - 0.5, z);
      g.add(post);
    }
  }
  const roof = gableBoardRoof(p, fp.halfDepth + 0.5, fp.halfWidth + 0.5, 35);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = postH;
  g.add(roof);

  const stack = kayaStack(p, 7, 4, fp.halfWidth * 2 - 0.8);
  g.add(stack);
  return g;
}

/** 小物。寸法は layout.ts の PROP_FOOTPRINT と対応する。 */
export function createProp(p: Palette, kind: PropKind): THREE.Object3D {
  switch (kind) {
    case 'woodpile': {
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6);
      for (let i = 0; i < 12; i++) {
        const log = shadowed(new THREE.Mesh(geo, i % 3 === 0 ? p.woodLight : p.woodWeathered));
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 0.2 + Math.floor(i / 4) * 0.36, ((i % 4) - 1.5) * 0.24);
        g.add(log);
      }
      return g;
    }
    case 'lantern': {
      const g = new THREE.Group();
      const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), p.stone));
      base.position.y = 0.15;
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6), p.stone));
      post.position.y = 0.75;
      const light = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), p.stone));
      light.position.y = 1.4;
      const top = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.45, 4), p.stone));
      top.position.y = 1.85;
      top.rotation.y = Math.PI / 4;
      g.add(base, post, light, top);
      return g;
    }
    case 'kayaBundles':
      return kayaStack(p, 3, 3, 3.0);
    case 'hasaRack': {
      // はさ掛け：刈った作物を干す木組み
      const g = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 2.4, 5);
      for (const x of [-3, -1, 1, 3]) {
        const post = shadowed(new THREE.Mesh(postGeo, p.woodWeathered));
        post.position.set(x, 1.1, 0);
        g.add(post);
      }
      const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 6.4, 5);
      for (const y of [1.2, 1.9]) {
        const bar = new THREE.Mesh(barGeo, p.woodWeathered);
        bar.rotation.z = Math.PI / 2;
        bar.position.y = y;
        g.add(bar);
      }
      const sheafGeo = new THREE.BoxGeometry(0.35, 0.9, 0.3);
      for (let i = 0; i < 16; i++) {
        const sheaf = shadowed(new THREE.Mesh(sheafGeo, p.crop));
        sheaf.position.set(-2.8 + i * 0.37, i % 2 === 0 ? 0.85 : 1.55, 0);
        g.add(sheaf);
      }
      return g;
    }
    case 'workbench': {
      const g = new THREE.Group();
      const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 1.2), p.woodLight));
      top.position.y = 0.9;
      g.add(top);
      const legGeo = new THREE.BoxGeometry(0.14, 0.85, 0.14);
      for (const x of [-1.05, 1.05]) {
        for (const z of [-0.45, 0.45]) {
          const leg = new THREE.Mesh(legGeo, p.woodDark);
          leg.position.set(x, 0.42, z);
          g.add(leg);
        }
      }
      return g;
    }
    case 'rock': {
      const rock = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), p.rock));
      rock.scale.set(1, 0.6, 0.85);
      rock.position.y = 0.2;
      return rock;
    }
  }
}
