import type { AmbientMix, MusicMood, Surface } from './mix';
import { scheduleMusic } from './musicScheduler';

/**
 * 音（Web Audio API で、その場で合成する。外部の音声ファイルは使わない）。
 *
 * - ブラウザの自動再生の制限に従い、ユーザーの操作（クリック・キー）の中で unlock() を呼ぶまで何も鳴らさない。
 * - 系統：音楽・環境音・効果音。それぞれの音量と、会話中などの下げ幅（ダッキング）を持つ。
 * - 何をどのくらい鳴らすかは mix.ts（純粋関数）が決め、ここは音作りと時間の管理だけを担当する。
 */
export type UiSound =
  | 'move'
  | 'confirm'
  | 'cancel'
  | 'open'
  | 'page'
  | 'notebook'
  | 'discover'
  | 'ledger'
  | 'decide'
  | 'transition'
  | 'promise';

/** 音楽の音階（ヨナ抜きに近い五音音階。周波数は D を基準にした比）。 */
const YO_SCALE = [1, 9 / 8, 4 / 3, 3 / 2, 27 / 16];
/** 少し陰りのある五音（第3幕）。 */
const IN_SCALE = [1, 16 / 15, 4 / 3, 3 / 2, 8 / 5];

interface MoodDef {
  readonly base: number;
  readonly scale: readonly number[];
  /** 音と音の間隔（秒）の範囲。 */
  readonly gap: readonly [number, number];
  /** 一つの句の音の数。 */
  readonly phrase: readonly [number, number];
  /** 句と句の間の休み（秒）。 */
  readonly rest: readonly [number, number];
  readonly drone: number;
}

const MOODS: Readonly<Record<Exclude<MusicMood, 'none'>, MoodDef>> = {
  title: { base: 293.66, scale: YO_SCALE, gap: [0.9, 1.5], phrase: [3, 5], rest: [3, 5], drone: 0.5 },
  village: { base: 293.66, scale: YO_SCALE, gap: [0.8, 1.4], phrase: [3, 6], rest: [7, 13], drone: 0 },
  roofDay: { base: 293.66, scale: YO_SCALE, gap: [0.45, 0.8], phrase: [4, 7], rest: [5, 9], drone: 0 },
  later: { base: 261.63, scale: IN_SCALE, gap: [1.0, 1.7], phrase: [3, 5], rest: [8, 14], drone: 0.3 },
  ending: { base: 293.66, scale: YO_SCALE, gap: [0.9, 1.4], phrase: [4, 6], rest: [3, 6], drone: 0.6 },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambientBus!: GainNode;
  private sfxBus!: GainNode;
  private musicDuck!: GainNode;
  private ambientDuck!: GainNode;
  private windGain!: GainNode;
  private waterGain!: GainNode;
  private fireGain!: GainNode;
  private droneGain!: GainNode;
  private noise!: AudioBuffer;

  private volumes = { music: 0, ambient: 0, sfx: 0 };
  private duck = { ambient: 1, music: 1 };
  private mix: AmbientMix = { wind: 0, water: 0, fire: 0, birds: 0 };
  private mood: MusicMood = 'none';
  private work = { volume: 0, interval: Infinity };

  private nextNote = 0;
  private phraseLeft = 0;
  private lastDegree = 0;
  private nextBird = 0;
  private nextCrackle = 0;
  private nextGust = 0;
  private nextWork = 0;

  /** 鳴らせる状態か（unlock 済み・一時停止していない）。 */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get state(): 'locked' | AudioContextState {
    return this.ctx?.state ?? 'locked';
  }

  /** ユーザー操作の中で呼ぶ。初回は音の系統を組み立て、以後は一時停止からの再開だけ。 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    this.build(this.ctx);
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  setVolumes(v: { music: number; ambient: number; sfx: number }): void {
    this.volumes = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(v.music, t, 0.05);
    this.ambientBus.gain.setTargetAtTime(v.ambient, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
  }

  setDuck(d: { ambient: number; music: number }): void {
    if (d.ambient === this.duck.ambient && d.music === this.duck.music) return;
    this.duck = { ...d };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ambientDuck.gain.setTargetAtTime(d.ambient, t, 0.35);
    this.musicDuck.gain.setTargetAtTime(d.music, t, 0.35);
  }

  setAmbient(mix: AmbientMix): void {
    const changed = mix.wind !== this.mix.wind || mix.water !== this.mix.water || mix.fire !== this.mix.fire;
    this.mix = mix;
    if (!this.ctx || !changed) return;
    const t = this.ctx.currentTime;
    this.waterGain.gain.setTargetAtTime(mix.water * 0.16, t, 0.6);
    this.fireGain.gain.setTargetAtTime(mix.fire * 0.05, t, 0.4);
  }

  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.phraseLeft = 0;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.nextNote = t + 1.2;
    this.droneGain.gain.setTargetAtTime(mood === 'none' ? 0 : MOODS[mood].drone * 0.05, t, 1.2);
  }

  setWork(work: { volume: number; interval: number }): void {
    this.work = work;
  }

  /** 毎フレーム呼ぶ。少し先までの音（音楽の音・鳥・火のはぜる音・作業の音・風の強弱）を予約する。 */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const ahead = now + 0.15;

    if (this.mood !== 'none') {
      const m = MOODS[this.mood];
      // 長く止まった後に過去の音をまとめて鳴らさない・1 回に予約する音数に上限（musicScheduler.ts。レビュー指摘 5）
      const clock = { nextNote: this.nextNote, phraseLeft: this.phraseLeft };
      for (const t of scheduleMusic(clock, now, ahead, m, Math.random)) this.musicNote(m, t);
      this.nextNote = clock.nextNote;
      this.phraseLeft = clock.phraseLeft;
    }
    if (this.nextGust < ahead) {
      // 風はゆっくり強弱をつける（単調にならないように）
      this.windGain.gain.setTargetAtTime(this.mix.wind * rand(0.07, 0.13), now, 1.8);
      this.nextGust = now + rand(2.5, 5);
    }
    if (this.mix.birds > 0 && this.nextBird < ahead) {
      if (this.nextBird > 0) this.bird(Math.max(now, this.nextBird));
      this.nextBird = now + rand(5, 14) / this.mix.birds;
    }
    if (this.mix.fire > 0 && this.nextCrackle < ahead) {
      this.crackle(Math.max(now, this.nextCrackle));
      this.nextCrackle = now + rand(0.12, 0.9);
    }
    if (this.work.volume > 0.01 && this.nextWork < ahead) {
      this.thud(Math.max(now, this.nextWork), this.work.volume);
      this.nextWork = Math.max(now, this.nextWork) + this.work.interval * rand(0.75, 1.3);
    }
  }

  footstep(surface: Surface, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const g = (running ? 0.2 : 0.14) * rand(0.8, 1.1);
    if (surface === 'dirt') {
      this.noiseBurst(t, 0.07, { type: 'lowpass', freq: rand(600, 900), q: 0.8 }, g * 1.1);
    } else {
      const f = surface === 'wood' ? rand(230, 280) : rand(330, 420);
      this.noiseBurst(t, 0.05, { type: 'bandpass', freq: f * 2, q: 2 }, g * 0.6);
      this.tone(t, f * 0.55, 0.07, g * 0.55, 'sine');
    }
  }

  play(sound: UiSound): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    switch (sound) {
      case 'move':
        return this.pluck(t, 880, 0.12, 0.035, this.sfxBus);
      case 'page':
        return this.pluck(t, 1180, 0.08, 0.018, this.sfxBus);
      case 'confirm':
        this.pluck(t, 660, 0.3, 0.05, this.sfxBus);
        return this.pluck(t + 0.07, 990, 0.35, 0.04, this.sfxBus);
      case 'cancel':
        this.pluck(t, 587, 0.25, 0.04, this.sfxBus);
        return this.pluck(t + 0.07, 440, 0.3, 0.035, this.sfxBus);
      case 'open':
        return this.sweep(t, 0.2, 1400, 3200, 0.05);
      case 'notebook':
        this.bell(t, 784, 1.2, 0.045);
        return this.bell(t + 0.12, 1175, 1.4, 0.035);
      case 'promise':
        this.bell(t, 587, 1.2, 0.045);
        return this.bell(t + 0.14, 880, 1.5, 0.04);
      case 'discover':
        this.bell(t, 659, 1.3, 0.04);
        this.bell(t + 0.13, 784, 1.3, 0.04);
        return this.bell(t + 0.26, 988, 1.8, 0.04);
      case 'ledger':
        // 帳面をめくる音と、木の机に置く音
        this.sweep(t, 0.32, 2200, 3600, 0.06);
        this.sweep(t + 0.16, 0.22, 1800, 2800, 0.04);
        return this.tone(t, 200, 0.12, 0.08, 'sine');
      case 'decide':
        this.noiseBurst(t, 0.04, { type: 'bandpass', freq: 1800, q: 1.5 }, 0.12);
        this.tone(t, 320, 0.1, 0.08, 'sine');
        this.bell(t + 0.1, 523.25, 2, 0.04);
        return this.bell(t + 0.1, 784, 2.2, 0.03);
      case 'transition':
        // 余韻の長い鈴の音（時間が過ぎたことの合図）
        this.bell(t, 220, 4.5, 0.06);
        this.bell(t, 441.3, 4, 0.035);
        return this.bell(t, 659, 3.5, 0.025);
    }
  }

  // ───────── 音の系統 ─────────

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // 急な大きな音で割れないように、最後に軽く圧縮する
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.musicDuck = ctx.createGain();
    this.ambientDuck = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.ambientBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicDuck.gain.value = this.duck.music;
    this.ambientDuck.gain.value = this.duck.ambient;
    this.musicBus.gain.value = this.volumes.music;
    this.ambientBus.gain.value = this.volumes.ambient;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.connect(this.musicDuck).connect(this.master);
    this.ambientBus.connect(this.ambientDuck).connect(this.master);
    this.sfxBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // 風・水・火の土台（ノイズをフィルターで整えて流し続ける）
    this.windGain = this.bed(ctx, { type: 'lowpass', freq: 420, q: 0.6 }, this.mix.wind * 0.1);
    this.waterGain = this.bed(ctx, { type: 'bandpass', freq: 1100, q: 0.7 }, this.mix.water * 0.16);
    this.fireGain = this.bed(ctx, { type: 'lowpass', freq: 260, q: 0.5 }, this.mix.fire * 0.05);

    // 持続音（タイトル・第3幕・結末の静かな下支え）
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 600;
    this.droneGain.connect(droneFilter).connect(this.musicBus);
    for (const [f, detune] of [
      [146.83, -4],
      [220, 3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(this.droneGain);
      o.start();
    }
    const t = ctx.currentTime;
    this.nextNote = t + 1;
    this.nextBird = t + 3;
    this.nextGust = t;
    if (this.mood !== 'none') this.droneGain.gain.value = MOODS[this.mood].drone * 0.05;
  }

  private bed(ctx: AudioContext, filter: { type: BiquadFilterType; freq: number; q: number }, gain: number): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // 同じノイズでも聞こえ方が重ならないよう、開始位置をずらす
    src.loopStart = 0;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.ambientBus);
    src.start(0, Math.random() * 1.8);
    return g;
  }

  // ───────── 音の部品 ─────────

  /** 爪弾く音（音楽・UI）。三角波＋倍音、速い立ち上がりと自然な減衰。 */
  private pluck(t: number, freq: number, decay: number, gain: number, bus: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(4000, freq * 3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(lp).connect(bus);
    for (const [mult, type, level] of [
      [1, 'triangle', 1],
      [2, 'sine', 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  private bell(t: number, freq: number, decay: number, gain: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.sfxBus);
    for (const [mult, level] of [
      [1, 1],
      [2.76, 0.18],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType, bus: AudioNode = this.sfxBus): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(
    t: number,
    dur: number,
    filter: { type: BiquadFilterType; freq: number; q: number },
    gain: number,
    bus: AudioNode = this.sfxBus,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  /** 紙がこすれるような音（周波数を動かしたノイズ）。 */
  private sweep(t: number, dur: number, from: number, to: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private musicNote(m: MoodDef, t: number): void {
    // 隣り合う音へ動くことを多くして、跳びすぎない旋律にする
    const step = pick([-2, -1, -1, 1, 1, 2, 0]);
    this.lastDegree = Math.max(0, Math.min(9, this.lastDegree + step));
    const octave = Math.floor(this.lastDegree / 5);
    const freq = m.base * m.scale[this.lastDegree % 5]! * 2 ** octave;
    this.pluck(t, freq, rand(1.4, 2.2), rand(0.05, 0.075), this.musicBus);
  }

  private bird(t: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    pan.connect(this.ambientBus);
    const count = Math.round(rand(2, 4));
    const base = rand(2600, 3400);
    for (let i = 0; i < count; i++) {
      const s = t + i * rand(0.13, 0.2);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.25, s + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.85, s + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.025, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.11);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.13);
    }
  }

  private crackle(t: number): void {
    this.noiseBurst(t, 0.012, { type: 'highpass', freq: 2500, q: 0.7 }, 0.05 * this.mix.fire * rand(0.4, 1), this.ambientBus);
  }

  /** 屋根の上で茅を叩いて整える音（こもった木の音）。 */
  private thud(t: number, volume: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.3, 0.3);
    pan.connect(this.ambientBus);
    const g = 0.09 * volume;
    this.tone(t, rand(140, 170), 0.09, g, 'sine', pan);
    this.noiseBurst(t, 0.05, { type: 'bandpass', freq: 600, q: 1.5 }, g * 0.6, pan);
  }
}
