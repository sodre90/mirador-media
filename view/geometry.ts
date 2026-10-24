import type { Box } from "../shared/document.ts";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Where the picture sits in a video element, which letterboxes it to keep its shape. */
export function pictureRect(element: Size, picture: Size): Rect {
  const scale = Math.min(element.width / picture.width, element.height / picture.height);
  const [width, height] = [picture.width * scale, picture.height * scale];
  return { left: (element.width - width) / 2, top: (element.height - height) / 2, width, height };
}

/** A point on the screen, relative to the element, in the source's pixels, kept on the picture. */
export function sourcePoint(picture: Rect, source: Size, x: number, y: number) {
  const clamp = (value: number, most: number) => Math.min(most, Math.max(0, value));
  return { x: clamp(((x - picture.left) / picture.width) * source.width, source.width), y: clamp(((y - picture.top) / picture.height) * source.height, source.height) };
}

/** The box two corners span, in whole source pixels. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  const [left, top] = [Math.round(Math.min(a.x, b.x)), Math.round(Math.min(a.y, b.y))];
  return { x: left, y: top, width: Math.round(Math.max(a.x, b.x)) - left, height: Math.round(Math.max(a.y, b.y)) - top };
}

/** Where a box of the source shows on the screen, relative to the element. */
export function boxOnScreen(picture: Rect, source: Size, box: Box): Rect {
  const [scaleX, scaleY] = [picture.width / source.width, picture.height / source.height];
  return { left: picture.left + box.x * scaleX, top: picture.top + box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY };
}
