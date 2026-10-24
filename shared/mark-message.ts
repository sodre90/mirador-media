import type { Box, Probe } from "./document.ts";
import { describeBox } from "./operations.ts";
import { formatExposure, formatTime, frameAt } from "./time.ts";

export interface MarkToSend {
  id: string;
  at: number;
  end: number | null;
  box: Box | null;
  note: string;
}

/**
 * What the agent reads with the marked frame: the file, the time and its frame number, the box in the source's pixels,
 * and the exposure the picture was shown with, so it needn't guess any of them from the user's words.
 */
export function markMessage(file: string, probe: Probe, mark: MarkToSend, shownExposure: number, frameTime: number) {
  const frames = (seconds: number) => frameAt(seconds, probe.fps);
  const when = mark.end === null ? `at ${formatTime(mark.at)} (frame ${frames(mark.at)})` : `from ${formatTime(mark.at)} to ${formatTime(mark.end)} (frames ${frames(mark.at)}–${frames(mark.end)})`;
  const where = mark.box ? `, in the box ${describeBox(mark.box)} of the ${probe.width}×${probe.height} frame` : "";
  const picture = `The picture is the frame at ${formatTime(frameTime)}${mark.box ? " with the box drawn on it in red" : ""}, ${shownExposure !== 0 ? `as the preview shows it, at exposure ${formatExposure(shownExposure)}` : "as shot"}.`;
  return `In ${file} ${when}${where}: ${mark.note}\n\n(Mark ${mark.id}. ${picture})`;
}
