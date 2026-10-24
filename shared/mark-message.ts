import type { Box, Probe } from "./document.ts";
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
  return ` It is the whole frame, before ${framing.length > 1 ? `${framing.slice(0, -1).join(", ")} and ${framing.at(-1)}` : framing[0]}.`;
}

/**
 * What the agent reads with the marked frame: the file, the time and its frame number, the box in the source's pixels,
 * and how the picture was shown, so it needn't guess any of them from the user's words. The picture is always the whole
 * frame, so that the box's pixels are the picture's.
 */
export function markMessage(file: string, probe: Probe, mark: MarkToSend, shown: { exposure: number; frame: FrameEdits }, frameTime: number) {
  const frames = (seconds: number) => frameAt(seconds, probe.fps);
  const when = mark.end === null ? `at ${formatTime(mark.at)} (frame ${frames(mark.at)})` : `from ${formatTime(mark.at)} to ${formatTime(mark.end)} (frames ${frames(mark.at)}–${frames(mark.end)})`;
  const where = mark.box ? `, in the box ${describeBox(mark.box)} of the ${probe.width}×${probe.height} frame` : "";
  const picture = `The picture is the frame at ${formatTime(frameTime)}${mark.box ? " with the box drawn on it in red" : ""}, ${shown.exposure !== 0 ? `as the preview shows it, at exposure ${formatExposure(shown.exposure)}` : "as shot"}.${framingNote(shown.frame)}`;
  return `In ${file} ${when}${where}: ${mark.note}\n\n(Mark ${mark.id}. ${picture})`;
}
