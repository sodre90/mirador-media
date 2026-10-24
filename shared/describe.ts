import { changesSetting, hasEdits, renderedName, sameEdits, SETTING_NAMES, SETTINGS, type Edits, type MediaDocument, type Mark, type SettingName } from "./document.ts";
import { describeBox, describeSpan, describeWhen } from "./operations.ts";
import { keptParts, keptPieces, resultLength } from "./timeline.ts";
import { formatFps, formatTime, SETTING_FORMATS } from "./time.ts";

export const OPERATIONS_HELP = `Operations (times in seconds into the source, boxes in the source's pixels):
- { op: "source", file: "clip.mp4" }: the video, relative to this file's folder
- { op: "trim", start: 5, end: 44 } keeps that part; { op: "untrim" } keeps all of it
- { op: "cut", start: 12, end: 15 } takes that part out; { op: "uncut", start: 12, end: 15 } puts it back
- { op: "exposure", ev: 0.5 }: stops brighter, or darker below 0, from -3 to 3; 0 is as shot
- { op: "speed", rate: 0.5 }: times as fast, from 0.25 to 4; 1 is as shot, and the sound keeps its pitch
- { op: "volume", level: 0.5 }: times as loud, from 0 (muted) to 4; 1 is as recorded
- Exposure, speed and volume take start and end too, to set that part only: its value replaces the clip's there. { op: "clear", edit: "speed", start?, end? } takes such parts off again
- { op: "mark-done", mark: "m1" } once you dealt with a mark; done: false opens it again
- { op: "mark", at: 39.2, end?: 44, box?: { x, y, width, height }, note: "…" }, { op: "remove-mark", mark: "m1" }`;

export function describeEdits(edits: Edits) {
  if (!hasEdits(edits)) return "none";
  const trim = edits.trim && `trim ${describeSpan(edits.trim)}`;
  const cuts = edits.cuts.length > 0 && `cut ${edits.cuts.map(describeSpan).join(", ")}`;
  return [trim, cuts, ...SETTING_NAMES.map((name) => describeSetting(edits, name))].filter(Boolean).join("; ");
}

/** The clip's value when it isn't as shot, then each range's: "exposure +1.00 EV, +2.00 EV from 0:40.00 to 0:42.00". */
function describeSetting(edits: Edits, name: SettingName) {
  const setting = edits[name];
  if (!changesSetting(setting, name)) return false;
  const format = SETTING_FORMATS[name];
  const clip = setting.clip !== SETTINGS[name].asShot ? [format(setting.clip)] : [];
  const ranges = setting.ranges.map(({ start, end, value }) => `${format(value)} from ${formatTime(start)} to ${formatTime(end)}`);
  return `${name} ${[...clip, ...ranges].join(", ")}`;
}

const describeMark = (mark: Mark) => `- ${mark.id} ${describeWhen(mark)}${mark.box ? `, box ${describeBox(mark.box)}` : ""}: ${mark.note || "(no note)"}${mark.done ? " (done)" : ""}`;

function describeSource(document: MediaDocument) {
  const { source } = document;
  if (!source) return 'No video yet. Name the one to edit, next to this file, with { op: "source", file: "clip.mp4" }.';
  if (!source.probe) return `Video: ${source.file}, not read yet; app_run probe reads its size, length and frame rate.`;
  const { width, height, fps, duration, audio } = source.probe;
  return `Video: ${source.file}, ${width}×${height}, ${formatFps(fps)} fps, ${formatTime(duration)}, ${audio ? "with sound" : "silent"}.`;
}

function describeResultLength({ source, edits }: MediaDocument) {
  if (!source?.probe || (!edits.trim && edits.cuts.length === 0 && !changesSetting(edits.speed, "speed"))) return "";
  const parts = keptParts(edits, source.probe.duration);
  return ` The result is ${formatTime(resultLength(keptPieces(edits, source.probe.duration)))} long${parts.length > 1 ? `, in ${parts.length} pieces` : ""}.`;
}

function describeRendered(document: MediaDocument) {
  const { rendered, edits, source } = document;
  if (!source) return null;
  if (!rendered) return `Not rendered yet; app_run render writes ${renderedName(source.file)}.`;
  const current = sameEdits(rendered.edits, edits) ? "with the edits as they are now" : `with older edits (${describeEdits(rendered.edits)}); app_run render renders these`;
  return `Rendered: ${rendered.file}, ${current}.`;
}

/** The document for the agent: the video, the edits the user previews, the marks open first, and how to change them. */
export function describeDocument(document: MediaDocument) {
  const marks = [...document.marks].sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at);
  const target = document.source ? renderedName(document.source.file) : "the edited file";
  return [
    describeSource(document),
    `Edits, which the user sees at once in the preview: ${describeEdits(document.edits)}.${describeResultLength(document)}`,
    describeRendered(document),
    marks.length > 0 ? `Marks the user made, open first:\n${marks.map(describeMark).join("\n")}` : "No marks yet.",
    `When your edits are done, run app_run render: it writes ${target} next to the source, in place of the one before, and the user compares it with the source.`,
    OPERATIONS_HELP,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}
