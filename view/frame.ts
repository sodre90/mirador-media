import type { Box } from "../shared/document.ts";
import type { Size } from "./geometry.ts";

export const MARK_COLOUR = "#ff2d55";

/** The CSS filter that previews an exposure, the way the render applies it. */
export const exposurePreview = (ev: number) => (ev === 0 ? "none" : `brightness(${2 ** ev})`);

/** The frame the video shows, at the source's size, as the preview shows it, with the box drawn on it: the picture the agent gets. */
export function capturedFrame(video: HTMLVideoElement, source: Size, filter: string, box: Box | null): Promise<Blob> {
  const canvas = Object.assign(document.createElement("canvas"), { width: source.width, height: source.height });
  const context = canvas.getContext("2d")!;
  context.filter = filter;
  context.drawImage(video, 0, 0, source.width, source.height);
  context.filter = "none";
  if (box) {
    const line = Math.max(2, Math.round(Math.min(source.width, source.height) / 180));
    context.lineWidth = line;
    context.strokeStyle = MARK_COLOUR;
    context.strokeRect(box.x + line / 2, box.y + line / 2, Math.max(1, box.width - line), Math.max(1, box.height - line));
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The frame couldn't be drawn."))), "image/jpeg", 0.9));
}
