import type { Box } from "./document.ts";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Quarter turns clockwise. */
export type Turn = 0 | 90 | 180 | 270;

/** What the crop, the straightening and the turn make of the frame, in that order. */
export interface FrameEdits {
  crop: Box | null;
  turn: Turn;
  /** Degrees clockwise. */
  straighten: number;
}

/** A map of the plane as CSS matrix() takes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `outer` after `inner`. */
export const then = (inner: Affine, outer: Affine): Affine => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
});

export const mapped = ({ a, b, c, d, e, f }: Affine, { x, y }: Point): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f });

export function inverted({ a, b, c, d, e, f }: Affine): Affine {
  const determinant = a * d - b * c;
  return { a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant, e: (c * f - d * e) / determinant, f: (b * e - a * f) / determinant };
}

export const moved = (x: number, y: number): Affine => ({ ...IDENTITY, e: x, f: y });

export const scaled = (by: number): Affine => ({ ...IDENTITY, a: by, d: by });

/** Turned by `degrees` clockwise on the screen, whose y grows downwards. */
export function turned(degrees: number): Affine {
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export const cssMatrix = ({ a, b, c, d, e, f }: Affine) => `matrix(${[a, b, c, d, e, f].join(", ")})`;

/** How far straightening by `degrees` zooms in, so the tilted picture still covers a frame of `size` to its corners. */
export function straightenZoom({ width, height }: Size, degrees: number) {
  const radians = Math.abs((degrees * Math.PI) / 180);
  return Math.cos(radians) + Math.max(width / height, height / width) * Math.sin(radians);
}

/** A quarter turn clockwise of a w×h picture lands it in an h×w frame, and so on. */
function quarterTurn(turn: Turn, { width, height }: Size): Affine {
  if (turn === 90) return { a: 0, b: 1, c: -1, d: 0, e: height, f: 0 };
  if (turn === 180) return { a: -1, b: 0, c: 0, d: -1, e: width, f: height };
  if (turn === 270) return { a: 0, b: -1, c: 1, d: 0, e: 0, f: width };
  return IDENTITY;
}

export const turnedSize = ({ width, height }: Size, turn: Turn): Size => (turn % 180 === 0 ? { width, height } : { width: height, height: width });

/** Video encoders take even sizes only, so a video's frame is kept even; a photo's isn't. */
export interface Sizing {
  even: boolean;
}

/**
 * The frame the edits make of a picture of `source` size, as the render makes it, and the map from the source's pixels to
 * the frame's: the crop first, in the source's pixels, then the straightening about the crop's middle, zoomed in to fill
 * it, then the turn.
 */
export function framed(source: Size, edits: FrameEdits, sizing: Sizing): { size: Size; matrix: Affine } {
  const { turn, straighten } = edits;
  const kept = edits.crop ? renderedCrop(source, edits, sizing) : { x: 0, y: 0, ...source };
  const [middleX, middleY] = [kept.width / 2, kept.height / 2];
  const cropping = moved(-kept.x, -kept.y);
  const straightening = straighten === 0 ? IDENTITY : [moved(-middleX, -middleY), turned(straighten), scaled(straightenZoom(kept, straighten)), moved(middleX, middleY)].reduce(then);
  const turning = quarterTurn(turn, kept);
  return { size: turnedSize(kept, turn), matrix: [cropping, straightening, turning].reduce(then) };
}

/** The crop's even part, at least 2 pixels. */
export const evenDown = (pixels: number) => Math.max(2, Math.floor(pixels / 2) * 2);

/** The part of the source the render keeps: the crop, or all of it, made even for a video. */
export function renderedCrop(source: Size, { crop }: FrameEdits, { even }: Sizing): Box {
  const kept = crop ?? { x: 0, y: 0, ...source };
  return even ? { x: kept.x, y: kept.y, width: evenDown(kept.width), height: evenDown(kept.height) } : kept;
}

/** A box's corners, as a map puts them: a box stays a rectangle, tilted when straightened. */
export const corners = (matrix: Affine, { x, y, width, height }: Box) =>
  [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((corner) => mapped(matrix, corner));
