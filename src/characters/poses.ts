/**
 * 人物の姿勢と簡単な動き（docs/PHASE5_ART.md §3〜4）。
 * 関節の角度（ラジアン）を時間の関数として返すだけの純粋な関数で、Three.js に依存しない。
 *
 * 角度の向き（personRig.ts の組み方に合わせる）：
 * - 腕・脚の rotation.x が負：前へ振る。胴の rotation.x が正：前へかがむ。頭の rotation.x が正：うつむく。
 * - 左腕の rotation.z が正／右腕の rotation.z が負：外へ開く。前腕の z は内側へ曲げる向き（左が負・右が正）。
 */
export interface JointPose {
  bodyY: number;
  bodyX: number;
  torsoX: number;
  torsoY: number;
  torsoZ: number;
  headX: number;
  headY: number;
  headZ: number;
  lArmX: number;
  lArmZ: number;
  lForeX: number;
  lForeZ: number;
  rArmX: number;
  rArmZ: number;
  rForeX: number;
  rForeZ: number;
  lLegX: number;
  rLegX: number;
}

export const POSE_KEYS = [
  'bodyY',
  'bodyX',
  'torsoX',
  'torsoY',
  'torsoZ',
  'headX',
  'headY',
  'headZ',
  'lArmX',
  'lArmZ',
  'lForeX',
  'lForeZ',
  'rArmX',
  'rArmZ',
  'rForeX',
  'rForeZ',
  'lLegX',
  'rLegX',
] as const satisfies ReadonlyArray<keyof JointPose>;

export function neutralPose(): JointPose {
  return {
    bodyY: 0,
    bodyX: 0,
    torsoX: 0,
    torsoY: 0,
    torsoZ: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    lArmX: 0,
    lArmZ: 0.06,
    lForeX: -0.12,
    lForeZ: 0,
    rArmX: 0,
    rArmZ: -0.06,
    rForeX: -0.12,
    rForeZ: 0,
    lLegX: 0,
    rLegX: 0,
  };
}

/**
 * 待機・作業の型。
 * - 人物の性格を出す待機：calm（ゆったり）／fidget（トキ：体重を移す・きょろきょろ）／handsFront（サエ：手を前で重ねる）／
 *   armsCrossed（宗平：腕を組む）／holdBook（ミネ：帳面を持つ）／lookField（伊助：畑を気にする）
 * - 状況による立ち姿：cane（第3幕のサエ：杖をつく。少し体重をかける程度）
 * - 屋根葺きの日の役割：direct（段取りを指示する）／carry（茅を担ぐ）／holdKaya（茅の束を抱える）／
 *   pass（梯子の下で茅を受け渡す）／tamp（屋根の上で茅を叩いて整える）／sort（茅の山で束をそろえる）／watch（見守る）
 */
export type PoseStyle =
  | 'calm'
  | 'fidget'
  | 'handsFront'
  | 'armsCrossed'
  | 'holdBook'
  | 'lookField'
  | 'cane'
  | 'direct'
  | 'carry'
  | 'holdKaya'
  | 'pass'
  | 'tamp'
  | 'sort'
  | 'watch';

/** その型で手に持つ物（personRig.ts の小物）。 */
export type HeldProp = 'cane' | 'book' | 'bundle' | 'kayaArms' | 'beater' | null;

export function heldPropFor(style: PoseStyle): HeldProp {
  switch (style) {
    case 'cane':
      return 'cane';
    case 'holdBook':
      return 'book';
    case 'carry':
      return 'bundle';
    case 'holdKaya':
    case 'pass':
      return 'kayaArms';
    case 'tamp':
      return 'beater';
    default:
      return null;
  }
}

/** 会話中に手振りを付ける腕（手がふさがっている型では空いている方、腕を組んでいるときはうなずくだけ）。 */
function talkArm(style: PoseStyle): 'left' | 'right' | null {
  switch (style) {
    case 'armsCrossed':
    case 'holdKaya':
    case 'pass':
      return null;
    case 'cane':
    case 'carry':
    case 'tamp':
      return 'left';
    default:
      return 'right';
  }
}

const s = Math.sin;

/** 待機・作業の姿勢。t は秒、seed で人ごとに拍子をずらす。 */
export function idlePose(style: PoseStyle, t: number, seed = 0): JointPose {
  const p = neutralPose();
  const tt = t + seed * 1.37;
  // 呼吸
  const breath = s(tt * 1.7);
  p.bodyY = breath * 0.008;
  p.torsoX = breath * 0.01;
  // ときどき視線を動かす（ゆっくり左右を見る）
  const glance = s(tt * 0.31) * s(tt * 0.17 + 1);
  p.headY = glance * 0.35;

  switch (style) {
    case 'calm':
      p.lArmZ = 0.08;
      p.rArmZ = -0.08;
      break;
    case 'watch':
      p.headX = -0.08;
      p.lArmX = -0.15;
      p.lForeX = -0.9;
      p.lForeZ = -0.6;
      p.rArmX = -0.15;
      p.rForeX = -0.9;
      p.rForeZ = 0.6;
      break;
    case 'fidget': {
      // 体重を左右に移し、首をかしげる
      const sway = s(tt * 1.1);
      p.bodyX = sway * 0.03;
      p.torsoZ = -sway * 0.04;
      p.headZ = s(tt * 0.7) * 0.12;
      p.headY = s(tt * 0.5) * 0.5;
      p.lLegX = Math.max(0, sway) * -0.08;
      p.rLegX = Math.max(0, -sway) * -0.08;
      p.lArmX = -0.1 + sway * 0.05;
      p.rArmX = -0.1 - sway * 0.05;
      break;
    }
    case 'handsFront':
      p.lArmX = -0.2;
      p.lArmZ = 0.02;
      p.lForeX = -0.95;
      p.lForeZ = -0.55;
      p.rArmX = -0.2;
      p.rArmZ = -0.02;
      p.rForeX = -0.95;
      p.rForeZ = 0.55;
      p.headX = 0.05;
      break;
    case 'armsCrossed':
      p.lArmX = -0.35;
      p.lArmZ = 0.12;
      p.lForeX = -1.45;
      p.lForeZ = -1.0;
      p.rArmX = -0.4;
      p.rArmZ = -0.12;
      p.rForeX = -1.35;
      p.rForeZ = 1.0;
      // ゆっくりうなずく
      p.headX = 0.06 + Math.max(0, s(tt * 0.45)) ** 6 * 0.12;
      break;
    case 'holdBook':
      p.lArmX = -0.25;
      p.lArmZ = 0.05;
      p.lForeX = -1.35;
      p.lForeZ = -0.55;
      p.headX = 0.1 + Math.max(0, s(tt * 0.35)) ** 4 * 0.15;
      break;
    case 'lookField': {
      // 畑の方（右）を気にする。ときどき帽子のつばに手をやる
      p.headY = 0.45 + glance * 0.25;
      const brim = Math.max(0, s(tt * 0.4)) ** 8;
      p.rArmX = -0.4 - brim * 2.0;
      p.rArmZ = -0.1 - brim * 0.2;
      p.rForeX = -0.3 - brim * 1.2;
      p.lArmX = -0.05;
      break;
    }
    case 'cane':
      // 右手で杖をつき、少しだけ体重を預ける
      p.rArmX = -0.32;
      p.rArmZ = -0.16;
      p.rForeX = -0.5;
      p.torsoZ = -0.035;
      p.bodyX = -0.02;
      p.lArmZ = 0.05;
      p.lForeX = -0.35;
      p.rLegX = -0.04;
      break;
    case 'direct': {
      // 屋根を指して指示する（腕を上げる・下ろすを繰り返す）
      const point = Math.max(0, s(tt * 0.6));
      p.headX = -0.35;
      p.rArmX = -1.9 - point * 0.5;
      p.rArmZ = -0.15;
      p.rForeX = -0.15;
      p.lArmX = -0.1;
      p.lArmZ = 0.25;
      p.lForeX = -1.3;
      p.lForeZ = -0.9; // 腰に手
      break;
    }
    case 'carry':
      // 右肩に茅の束を担ぐ
      p.rArmX = -2.6;
      p.rArmZ = -0.15;
      p.rForeX = -1.2;
      p.headZ = 0.06;
      p.torsoZ = 0.04;
      break;
    case 'holdKaya':
      p.lArmX = -0.5;
      p.lForeX = -1.1;
      p.lForeZ = -0.4;
      p.rArmX = -0.5;
      p.rForeX = -1.1;
      p.rForeZ = 0.4;
      p.headX = 0.05;
      break;
    case 'pass': {
      // 茅の束を持ち上げて、梯子の上の人へ渡す
      const lift = (s(tt * 1.6) + 1) / 2;
      p.lArmX = -0.6 - lift * 1.9;
      p.rArmX = -0.6 - lift * 1.9;
      p.lForeX = -0.9 + lift * 0.6;
      p.rForeX = -0.9 + lift * 0.6;
      p.lForeZ = -0.35;
      p.rForeZ = 0.35;
      p.headX = -0.15 - lift * 0.35;
      p.torsoX = -lift * 0.08;
      break;
    }
    case 'tamp': {
      // 屋根の上で、茅を叩いて整える（膝をついて前かがみ）
      const hit = Math.abs(s(tt * 3.2));
      p.bodyY = -0.38;
      p.torsoX = 0.5;
      p.headX = 0.2;
      p.lLegX = -1.4;
      p.rLegX = -0.6;
      p.rArmX = -0.9 - hit * 0.9;
      p.rForeX = -0.6 + hit * 0.4;
      p.lArmX = -0.6;
      p.lForeX = -0.8;
      p.lForeZ = -0.3;
      break;
    }
    case 'sort': {
      // 茅の山で、かがんで束をそろえる
      const reach = (s(tt * 1.2) + 1) / 2;
      p.torsoX = 0.55 + reach * 0.15;
      p.bodyY = -0.06;
      p.headX = 0.25;
      p.lArmX = -0.6 - reach * 0.3;
      p.rArmX = -0.7 - reach * 0.3;
      p.lForeX = -0.5;
      p.rForeX = -0.5;
      p.lLegX = -0.1;
      p.rLegX = 0.1;
      break;
    }
  }
  return p;
}

/** 会話中の身振り（話している間：手振りとうなずき）。idlePose に重ねる。 */
export function addTalkGesture(p: JointPose, style: PoseStyle, t: number, amount: number): JointPose {
  if (amount <= 0) return p;
  p.headX += (Math.max(0, s(t * 2.4)) ** 2 * 0.1 - 0.02) * amount;
  p.headZ += s(t * 1.3) * 0.04 * amount;
  const arm = talkArm(style);
  const wave = s(t * 3.1) * 0.5 + 0.5;
  if (arm === 'right') {
    p.rArmX = mix(p.rArmX, -0.45 - wave * 0.25, amount);
    p.rArmZ = mix(p.rArmZ, -0.12, amount);
    p.rForeX = mix(p.rForeX, -1.0 - wave * 0.3, amount);
    p.rForeZ = mix(p.rForeZ, 0.25, amount);
  } else if (arm === 'left') {
    p.lArmX = mix(p.lArmX, -0.45 - wave * 0.25, amount);
    p.lArmZ = mix(p.lArmZ, 0.12, amount);
    p.lForeX = mix(p.lForeX, -1.0 - wave * 0.3, amount);
    p.lForeZ = mix(p.lForeZ, -0.25, amount);
  }
  return p;
}

/**
 * 歩く姿勢。phase は足の運びの位相、intensity は 0（止まる）〜1（走る）。
 * carrying のときは右腕を担いだ形のまま、左腕だけ振る。
 */
export function walkPose(phase: number, intensity: number, moving: boolean, carrying = false): JointPose {
  const p = neutralPose();
  const amp = (0.25 + intensity * 0.55) * (moving ? 1 : 0);
  const swing = s(phase) * amp;
  p.lLegX = swing;
  p.rLegX = -swing;
  p.lArmX = -swing * 0.7;
  p.lForeX = -0.15 - Math.max(0, -swing) * 0.4;
  p.rArmX = swing * 0.7;
  p.rForeX = -0.15 - Math.max(0, swing) * 0.4;
  p.bodyY = Math.abs(Math.cos(phase)) * 0.05 * intensity * (moving ? 1 : 0);
  p.torsoX = intensity * 0.08 * (moving ? 1 : 0);
  p.torsoY = swing * 0.12;
  if (carrying) {
    p.rArmX = -2.6;
    p.rArmZ = -0.15;
    p.rForeX = -1.2;
  }
  return p;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 今の姿勢を目標の姿勢へ近づける（k：0〜1、フレームごとの追従の割合）。 */
export function blendPose(current: JointPose, target: JointPose, k: number): void {
  for (const key of POSE_KEYS) current[key] += (target[key] - current[key]) * k;
}
