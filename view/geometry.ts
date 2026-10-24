import type { Box } from "../shared/document.ts";
import { framed, inverted, mapped, scaled, then, type Affine, type FrameEdits, type Point, type Size } from "../shared/geometry.ts";

export interface FrameOnStage {
  left: number;
  top: number;
  width: number;
  height: number;
  /** From the source's pixels to the frame's on the screen. */
  toScreen: Affine;
}

/** Where the frame the edits make sits on the stage, as large as fits, and how the source maps onto it. */
export function frameOnStage(stage: Size, source: Size, edits: FrameEdits): FrameOnStage {
  const { size, matrix } = framed(source, edits);
  const scale = Math.min(stage.width / size.width, stage.height / size.height);
  const [width, height] = [size.width * scale, size.height * scale];
  return { left: (stage.width - width) / 2, top: (stage.height - height) / 2, width, height, toScreen: then(matrix, scaled(scale)) };
}

/** A point on the frame, relative to it, in the source's pixels, kept on the source. */
export function sourcePoint(frame: FrameOnStage, source: Size, x: number, y: number): Point {
  const point = mapped(inverted(frame.toScreen), { x, y });
  const clamp = (value: number, most: number) => Math.min(most, Math.max(0, value));
  return { x: clamp(point.x, source.width), y: clamp(point.y, source.height) };
}

/** The box two corners span, in whole source pixels. */
export function boxBetween(a: Point, b: Point): Box {
  const [left, top] = [Math.round(Math.min(a.x, b.x)), Math.round(Math.min(a.y, b.y))];
  return { x: left, y: top, width: Math.round(Math.max(a.x, b.x)) - left, height: Math.round(Math.max(a.y, b.y)) - top };
}
