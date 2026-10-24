import { hasEdits, type Box, type Edits, type Probe } from "./document.ts";
import { describeEdits } from "./describe.ts";
import { describeBox } from "./operations.ts";
import { formatTime, frameAt } from "./time.ts";

export interface MarkToSend {
  id: string;
  at: number;
  end: number | null;
  box: Box | null;
  note: string;
}

/**
 * What the agent reads with the marked frame: the file, the time and its frame number, the box in the source's pixels,
 * and the edits the picture shows, so it needn't guess any of them from the user's words.
 */
export function markMessage(file: string, probe: Probe, mark: MarkToSend, shown: Edits, frameTime: number) {
  const frames = (seconds: number) => frameAt(seconds, probe.fps);
  const when = mark.end === null ? `at ${formatTime(mark.at)} (frame ${frames(mark.at)})` : `from ${formatTime(mark.at)} to ${formatTime(mark.end)} (frames ${frames(mark.at)}–${frames(mark.end)})`;
  const where = mark.box ? `, in the box ${describeBox(mark.box)} of the ${probe.width}×${probe.height} frame` : "";
  const picture = `The picture is the frame at ${formatTime(frameTime)}${mark.box ? " with the box drawn on it in red" : ""}, ${hasEdits(shown) ? `as the preview shows it with the edits: ${describeEdits(shown)}` : "as shot"}.`;
  return `In ${file} ${when}${where}: ${mark.note}\n\n(Mark ${mark.id}. ${picture})`;
}
