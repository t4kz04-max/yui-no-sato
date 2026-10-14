import * as THREE from 'three';

/** 地平線の空の色（霧・背景・遠景の山の大気遠近に使う）。 */
export const SKY_HORIZON = 0xe2e2d2;
const SKY_ZENITH = 0x86a9c8;

export interface Lighting {
  readonly sun: THREE.DirectionalLight;
  /** 太陽の方向（光が来る向き、正規化済み）。 */
  readonly sunDirection: THREE.Vector3;
  readonly horizon: THREE.Color;
}

/**
 * 秋の午後の柔らかい日差し（docs/PHASE5_ART.md §5）。
 * - 日差し：やや低く暖かい光。影は村の歩行範囲全体を覆う固定範囲で描く（追従させると移動時に影がちらつくため）。
 * - 空の光：上から青く、地面からの照り返しは暖かく。
 * - 空：地平線から天頂への色の移り変わり。霧の色を地平線に合わせ、遠くの物が空に溶け込むようにする。
 */
export function setupLighting(scene: THREE.Scene): Lighting {
  const horizon = new THREE.Color(SKY_HORIZON);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON, 85, 300);
  scene.add(createSkyDome(horizon, new THREE.Color(SKY_ZENITH)));

  scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x6b5638, 1.15));
  scene.add(new THREE.AmbientLight(0xfff0d8, 0.25));

  const sun = new THREE.DirectionalLight(0xffdcae, 2.6);
  sun.position.set(-48, 52, 44);
  sun.target.position.set(0, 0, -2);
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
  const sunDirection = sun.position.clone().sub(sun.target.position).normalize();
  return { sun, sunDirection, horizon };
}

/** 空の半球（地平線→天頂のグラデーション）。カメラに追従させなくても、十分大きいので端は見えない。 */
function createSkyDome(horizon: THREE.Color, zenith: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(520, 24, 12);
  const mat = new THREE.ShaderMaterial({
    uniforms: { horizon: { value: horizon }, zenith: { value: zenith } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float t = smoothstep(0.0, 0.55, vDir.y);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}
