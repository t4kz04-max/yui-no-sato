import * as THREE from 'three';

export const SKY_COLOR = 0xd6e2e8;

/**
 * 秋の午後の柔らかい日差し（既存試作の光源構成を移植）。
 * 影は村の歩行範囲全体を覆う固定範囲で描く（追従させると移動時に影がちらつくため）。
 */
export function setupLighting(scene: THREE.Scene): THREE.DirectionalLight {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 70, 260);

  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x5a4a33, 1.1));
  scene.add(new THREE.AmbientLight(0xfff1dc, 0.35));

  const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
  sun.position.set(-45, 60, 40);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 62;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
