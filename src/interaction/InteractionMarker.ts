import * as THREE from 'three';

/**
 * 操作できる対象の足元に出す光の輪（3D 側のハイライト）。
 * 画面上の「E 話す」の案内と組み合わせて、どれが対象か分かるようにする。
 */
export class InteractionMarker {
  readonly root: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private time = 0;
  private baseScale = 1;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffe2a0,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const geometry = new THREE.RingGeometry(0.55, 0.7, 48).rotateX(-Math.PI / 2);
    this.root = new THREE.Mesh(geometry, this.material);
    this.root.name = 'interaction-marker';
    this.root.renderOrder = 2;
    this.root.visible = false;
  }

  show(x: number, y: number, z: number, scale: number): void {
    this.root.position.set(x, y + 0.06, z);
    this.baseScale = scale;
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;
    const pulse = 1 + Math.sin(this.time * 4) * 0.06;
    this.root.scale.setScalar(this.baseScale * pulse);
    this.material.opacity = 0.55 + Math.sin(this.time * 4) * 0.2;
  }
}
