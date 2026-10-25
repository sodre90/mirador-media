import { isPhoto, type Box, type Probe } from "./document.ts";
import type { FrameEdits } from "./geometry.ts";
import { describeBox } from "./operations.ts";
import { formatExposure, formatTime, frameAt } from "./time.ts";

export interface MarkToSend {
  id: string;
  at: number;
  end: number | null;
  box: Box | null;
  note: string;
}

function framingNote({ crop, straighten, turn }: FrameEdits) {
  const framing = [crop && "the crop", straighten !== 0 && "the straightening", turn !== 0 && "the turn"].filter(Boolean);
  if (framing.length === 0) return "";
  return ` The box is in the whole frame, before ${framing.length > 1 ? `${framing.slice(0, -1).join(", ")} and ${framing.at(-1)}` : framing[0]}.`;
}

/**
 * What the agent reads about a mark: the file, the time and its frame number, the box in the source's pixels, and how
 * the user saw it, so it needn't guess any of them from the user's words. No picture goes with it: the agent looks at
 * the file itself when it needs to see.
 */
export function markMessage(file: string, probe: Probe, mark: MarkToSend, shown: { exposure: number; frame: FrameEdits }, frameTime: number) {
  const asShown = `${shown.exposure !== 0 ? `at exposure ${formatExposure(shown.exposure)}` : "as shot"}.${mark.box ? framingNote(shown.frame) : ""}`;
  if (isPhoto(file)) {
    const where = mark.box ? `, in the box ${describeBox(mark.box)} of the ${probe.width}×${probe.height} photo` : "";
    return `In ${file}${where}: ${mark.note}\n\n(Mark ${mark.id}, made on the photo ${asShown} To see it, open ${file}.)`;
  }
  const frames = (seconds: number) => frameAt(seconds, probe.fps);
  const when = mark.end === null ? `at ${formatTime(mark.at)} (frame ${frames(mark.at)})` : `from ${formatTime(mark.at)} to ${formatTime(mark.end)} (frames ${frames(mark.at)}–${frames(mark.end)})`;
  const where = mark.box ? `, in the box ${describeBox(mark.box)} of the ${probe.width}×${probe.height} frame` : "";
  return `In ${file} ${when}${where}: ${mark.note}\n\n(Mark ${mark.id}, made on the frame at ${formatTime(frameTime)} ${asShown} To see it, take that frame from ${file}, as with ffmpeg.)`;
}
