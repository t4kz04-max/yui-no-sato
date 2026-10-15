/**
 * 音楽の音の予約（レビュー指摘 5）。Web Audio に依存しない。
 *
 * AudioContext の時刻だけが進み、ゲームの更新が長く止まる（タブを裏にする・スリープ）と、
 * 次に鳴らす時刻が大きく過去になる。そのまま追いかけると、過去の音を今の時刻にまとめて予約してしまう。
 * - maxLag 秒より遅れていたら、過去の音は鳴らさず、少し間を置いて今から自然に再開する（句の途中からは始めない）。
 * - 1 回の更新で予約する音は maxNotes まで。
 * 通常の短いフレームの遅れ（maxLag 未満）では、そのまま続ける（音楽が途切れない）。
 */
export interface MusicClock {
  /** 次の音を鳴らす時刻（AudioContext の秒）。 */
  nextNote: number;
  /** 今の句に残っている音の数（0 なら次は句の間の休み）。 */
  phraseLeft: number;
}

export interface MusicPacing {
  readonly gap: readonly [number, number];
  readonly phrase: readonly [number, number];
  readonly rest: readonly [number, number];
}

export const MUSIC_MAX_LAG = 1;
export const MUSIC_MAX_NOTES_PER_UPDATE = 4;
/** 長い中断の後に再開するまでの間（秒）。 */
export const MUSIC_RESUME_DELAY = 0.8;

/** この更新で鳴らす音の時刻の一覧を返し、clock を進める。 */
export function scheduleMusic(
  clock: MusicClock,
  now: number,
  ahead: number,
  pacing: MusicPacing,
  rand: () => number,
  maxNotes = MUSIC_MAX_NOTES_PER_UPDATE,
  maxLag = MUSIC_MAX_LAG,
): number[] {
  const between = (r: readonly [number, number]) => r[0] + rand() * (r[1] - r[0]);
  if (clock.nextNote < now - maxLag) {
    clock.nextNote = now + MUSIC_RESUME_DELAY;
    clock.phraseLeft = 0;
  }
  const times: number[] = [];
  // 休みの切り替えも数えて、どんな値でも有限回で抜ける
  for (let guard = 0; clock.nextNote < ahead && times.length < maxNotes && guard < maxNotes * 2 + 2; guard++) {
    if (clock.phraseLeft <= 0) {
      clock.phraseLeft = Math.round(between(pacing.phrase));
      clock.nextNote += between(pacing.rest);
      continue;
    }
    times.push(Math.max(now, clock.nextNote));
    clock.phraseLeft--;
    clock.nextNote += between(pacing.gap);
  }
  return times;
}
