import { SETTING_NAMES, settingAt, type Edits, type SettingName, type Span } from "./document.ts";
import { remainingOf } from "./spans.ts";

/** What the settings are at a moment. */
export type Looks = Record<SettingName, number>;

/** A part of the source the edits keep, played as one piece of the result, with the same looks all through. */
export interface Piece extends Span, Looks {}

/** The parts of the source the result keeps, in order: what the trim keeps, less the cuts. */
export const keptParts = (edits: Edits, duration: number) => remainingOf(edits.trim ?? { start: 0, end: duration }, edits.cuts);

export const looksAt = (edits: Edits, time: number) => Object.fromEntries(SETTING_NAMES.map((name) => [name, settingAt(edits[name], time)])) as Looks;

const sameLooks = (a: Looks, b: Looks) => SETTING_NAMES.every((name) => a[name] === b[name]);

/** The kept parts split where a setting's range starts or ends, so that each piece plays with the same looks. */
export function keptPieces(edits: Edits, duration: number): Piece[] {
  const edges = SETTING_NAMES.flatMap((name) => edits[name].ranges.flatMap(({ start, end }) => [start, end]));
  return keptParts(edits, duration).flatMap(({ start, end }) => {
    const inside = [...new Set(edges.filter((edge) => edge > start && edge < end))].sort((a, b) => a - b);
    const bounds = [start, ...inside, end];
    const pieces = bounds.slice(1).map((pieceEnd, index) => ({ start: bounds[index]!, end: pieceEnd, ...looksAt(edits, (bounds[index]! + pieceEnd) / 2) }));
    return pieces.reduce<Piece[]>((joined, piece) => {
      const previous = joined.at(-1);
      return previous && sameLooks(previous, piece) ? [...joined.slice(0, -1), { ...previous, end: piece.end }] : [...joined, piece];
    }, []);
  });
}

/** How long a piece plays in the result. */
const playedLength = ({ start, end, speed }: Piece) => (end - start) / speed;

export const resultLength = (pieces: Piece[]) => pieces.reduce((total, piece) => total + playedLength(piece), 0);

/** Where the result shows a moment of the source; a moment that was cut out shows where the result goes on. */
export function resultTime(pieces: Piece[], sourceTime: number) {
  let before = 0;
  for (const piece of pieces) {
    if (sourceTime < piece.end) return before + Math.max(0, sourceTime - piece.start) / piece.speed;
    before += playedLength(piece);
  }
  return before;
}

/** The moment of the source a time of the result shows. */
export function sourceTime(pieces: Piece[], resultTime: number) {
  let left = resultTime;
  for (const piece of pieces) {
    if (left < playedLength(piece)) return piece.start + Math.max(0, left) * piece.speed;
    left -= playedLength(piece);
  }
  return pieces.at(-1)?.end ?? 0;
}

/**
 * Where playback of the result is at a moment of the source: there when a piece keeps it, else at the start of the next
 * piece, going forwards, or at the end of the one before, going back. Past the last piece it is that piece's end.
 */
export function keptMoment(pieces: Span[], time: number, direction: 1 | -1 = 1) {
  if (pieces.some(({ start, end }) => time >= start && time < end)) return time;
  const next = pieces.find(({ start }) => start > time);
  const previous = pieces.findLast(({ end }) => end <= time);
  if (direction === -1 && previous) return previous.end;
  return next?.start ?? previous?.end ?? time;
}
