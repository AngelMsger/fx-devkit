// Terminal columns, not string length: East Asian wide characters and emoji take two
// columns and combining marks take none, so tables holding them still line up.

const NARROW = /^[\x20-\x7e]*$/;
// Hangul Jamo, CJK with its punctuation, Yi, Hangul syllables, the compatibility and
// fullwidth forms, the supplementary ideographic planes, and whatever shows as an emoji.
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}\p{Emoji_Presentation}]/u;
// Combining marks, zero-width spaces and joiners, variation selectors.
const ZERO = /[\p{Mn}\p{Me}\u200b-\u200d\ufe00-\ufe0f]/u;

export function widthOf(text: string): number {
  if (NARROW.test(text)) return text.length;
  let width = 0;
  for (const character of text) width += characterWidth(character);
  return width;
}

function characterWidth(character: string): number {
  if (ZERO.test(character)) return 0;
  return WIDE.test(character) ? 2 : 1;
}

// The spaces that complete `text` to `width` columns. Append them after painting, so
// control sequences never count toward a column.
export function gap(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - widthOf(text)));
}

// Text too long for `width` ends in the ellipsis; where not even that fits it stays whole.
export function truncate(text: string, width: number, ellipsis: string): string {
  const room = width - widthOf(ellipsis);
  if (widthOf(text) <= width || room < 0) return text;
  let kept = '';
  let used = 0;
  for (const character of text) {
    used += characterWidth(character);
    if (used > room) break;
    kept += character;
  }
  return kept + ellipsis;
}

// Lines of at most `width` columns, broken at spaces where there are any and inside a
// word only when the word alone is too long. A line break in the text is kept.
export function wrap(text: string, width: number): string[] {
  return text.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, width));
}

function wrapParagraph(paragraph: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    const joined = line === '' ? word : `${line} ${word}`;
    if (widthOf(joined) <= width) {
      line = joined;
      continue;
    }
    const pieces = pieced(word, width);
    lines.push(...(line === '' ? [] : [line]), ...pieces.slice(0, -1));
    line = pieces.at(-1) ?? '';
  }
  return [...lines, line];
}

// A word cut into pieces that each fit; a character wider than the room still gets a piece.
function pieced(word: string, width: number): string[] {
  const pieces = [''];
  let used = 0;
  for (const character of word) {
    const columns = characterWidth(character);
    if (used > 0 && used + columns > width) {
      pieces.push('');
      used = 0;
    }
    pieces[pieces.length - 1] += character;
    used += columns;
  }
  return pieces;
}
