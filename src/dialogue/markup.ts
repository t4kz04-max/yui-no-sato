/**
 * 台詞の簡単な強調記法。`**…**` で囲んだ部分を、その場で必ず理解してほしい要点として強調表示する
 * （docs/PHASE3_5_IMPROVEMENT.md「B」情報の第1段階）。
 */
export interface TextSegment {
  readonly text: string;
  readonly strong: boolean;
}

export function parseEmphasis(source: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = source.split('**');
  parts.forEach((text, i) => {
    // 閉じていない ** は普通の文字として扱う
    const strong = i % 2 === 1 && i < parts.length - 1;
    if (text === '') return;
    if (i % 2 === 1 && !strong) segments.push({ text: `**${text}`, strong: false });
    else segments.push({ text, strong });
  });
  return segments;
}

/** 記法を取り除いた文字列（文字送りの長さ・テストの照合に使う）。 */
export function plainText(source: string): string {
  return parseEmphasis(source)
    .map((s) => s.text)
    .join('');
}
