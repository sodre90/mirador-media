import type { Edits, Span } from "./document.ts";
import { remainingOf } from "./spans.ts";

/** A part of the source the edits keep, played as one piece of the result. */
export type Piece = Span;

/** The pieces the result is made of, in order: what the trim keeps, less the cuts. */
export const keptPieces = (edits: Edits, duration: number): Piece[] => remainingOf(edits.trim ?? { start: 0, end: duration }, edits.cuts);

const lengthOf = ({ start, end }: Span) => end - start;

export const resultLength = (pieces: Piece[]) => pieces.reduce((total, piece) => total + lengthOf(piece), 0);

/** Where the result shows a moment of the source; a moment that was cut out shows where the result goes on. */
export function resultTime(pieces: Piece[], sourceTime: number) {
  let before = 0;
  for (const piece of pieces) {
    if (sourceTime < piece.end) return before + Math.max(0, sourceTime - piece.start);
    before += lengthOf(piece);
  }
  return before;
}

/** The moment of the source a time of the result shows. */
export function sourceTime(pieces: Piece[], resultTime: number) {
  let left = resultTime;
  for (const piece of pieces) {
    if (left < lengthOf(piece)) return piece.start + Math.max(0, left);
    left -= lengthOf(piece);
  }
  return pieces.at(-1)?.end ?? 0;
}

/**
 * Where playback of the result is at a moment of the source: there when a piece keeps it, else at the start of the next
 * piece, going forwards, or at the end of the one before, going back. Past the last piece it is that piece's end.
 */
export function keptMoment(pieces: Piece[], time: number, direction: 1 | -1 = 1) {
  if (pieces.some(({ start, end }) => time >= start && time < end)) return time;
  const next = pieces.find(({ start }) => start > time);
  const previous = pieces.findLast(({ end }) => end <= time);
  if (direction === -1 && previous) return previous.end;
  return next?.start ?? previous?.end ?? time;
}
