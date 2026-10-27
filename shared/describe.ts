import { changesSetting, fileName, hasEdits, isPhoto, renderedName, sameEdits, SETTING_NAMES, SETTINGS, type Edits, type Item, type MediaDocument, type Mark, type SettingName } from "./document.ts";
import { framed } from "./geometry.ts";
import { describeBox, describeSpan, describeStraighten, describeTurn, describeWhen, settingOperation } from "./operations.ts";
import { keptParts, keptPieces, resultLength } from "./timeline.ts";
import { formatFps, formatTime, SETTING_FORMATS } from "./time.ts";

const SOURCE_HELP = '- { op: "source", file: "clip.mp4" }: the video, or a .jpg, .png, .webp or .heic photo, relative to this file\'s folder';
const ITEMS_HELP =
  '- { op: "items", items: [{ file: "takes/a.wav", label?: "Take 1", group?: "Narrator" }] }: sounds, videos or photos for the user to play and choose from, in place of a video to edit';
const EXPOSURE_HELP = '- { op: "exposure", ev: 0.5 }: stops brighter, or darker below 0, from -3 to 3; 0 is as shot';
const FRAME_HELP = [
  '- { op: "crop", x, y, width, height } keeps that part of the frame, in the source\'s pixels; { op: "uncrop" }',
  '- { op: "straighten", degrees: 2.5 }: clockwise, or anticlockwise below 0, from -45 to 45, inside the crop and zoomed in to fill it',
  '- { op: "turn", degrees: 90 }: quarter turns clockwise from as shot, 90, 180 or 270; 0 turns it back. The crop comes first, then the straightening, then the turn',
];
const MARK_DONE_HELP = '- { op: "mark-done", mark: "m1" } once you dealt with a mark; done: false opens it again';

export const OPERATIONS_HELP = [
  "Operations (times in seconds into the source, boxes in the source's pixels):",
  SOURCE_HELP,
  ITEMS_HELP,
  '- { op: "trim", start: 5, end: 44 } keeps that part; { op: "untrim" } keeps all of it',
  '- { op: "cut", start: 12, end: 15 } takes that part out; { op: "uncut", start: 12, end: 15 } puts it back',
  EXPOSURE_HELP,
  '- { op: "speed", rate: 0.5 }: times as fast, from 0.25 to 4; 1 is as shot, and the sound keeps its pitch',
  '- { op: "volume", level: 0.5 }: times as loud, from 0 (muted) to 4; 1 is as recorded',
  '- Exposure, speed and volume take start and end too, to set that part only: its value replaces the clip\'s there. { op: "clear", edit: "speed", start?, end? } takes such parts off again',
  ...FRAME_HELP,
  MARK_DONE_HELP,
  '- { op: "mark", at: 39.2, end?: 44, box?: { x, y, width, height }, note: "…" }, { op: "remove-mark", mark: "m1" }',
].join("\n");

/** A photo has no time, so the operations on it are the exposure, the frame and the marks. */
export const PHOTO_OPERATIONS_HELP = [
  "Operations (boxes in the photo's pixels, as it is shown upright):",
  SOURCE_HELP,
  ITEMS_HELP,
  EXPOSURE_HELP,
  ...FRAME_HELP,
  MARK_DONE_HELP,
  '- { op: "mark", box?: { x, y, width, height }, note: "…" }, { op: "remove-mark", mark: "m1" }',
].join("\n");

/** Files to choose from have no edits: the agent lists them again, or opens one to edit. */
export const ITEMS_OPERATIONS_HELP = ["Operations:", ITEMS_HELP.replace(": sounds,", ": lists again the sounds,"), SOURCE_HELP].join("\n");

export function describeEdits(edits: Edits) {
  if (!hasEdits(edits)) return "none";
  const trim = edits.trim && `trim ${describeSpan(edits.trim)}`;
  const cuts = edits.cuts.length > 0 && `cut ${edits.cuts.map(describeSpan).join(", ")}`;
  const crop = edits.crop && `crop ${describeBox(edits.crop)}`;
  const straighten = edits.straighten !== 0 && `straightened ${describeStraighten(edits.straighten)}`;
  const turn = edits.turn !== 0 && `turned ${describeTurn(edits.turn)}`;
  return [trim, cuts, ...SETTING_NAMES.map((name) => describeSetting(edits, name)), crop, straighten, turn].filter(Boolean).join("; ");
}

/** An edit of the whole picture, as the pane shows it, with the operation that takes it off. */
export interface WholeClipEdit {
  name: string;
  value: string;
  undo: Record<string, unknown>;
}

export const SETTING_TITLES: Record<SettingName, string> = { exposure: "Exposure", speed: "Speed", volume: "Volume" };

export function wholeClipEdits(edits: Edits): WholeClipEdit[] {
  const settings = SETTING_NAMES.filter((name) => edits[name].clip !== SETTINGS[name].asShot).map((name) => ({
    name: SETTING_TITLES[name],
    value: SETTING_FORMATS[name](edits[name].clip),
    undo: settingOperation(name, SETTINGS[name].asShot),
  }));
  const crop: WholeClipEdit | null = edits.crop && { name: "Crop", value: `${edits.crop.width}×${edits.crop.height}`, undo: { op: "uncrop" } };
  const straighten: WholeClipEdit | false = edits.straighten !== 0 && { name: "Straighten", value: `${edits.straighten > 0 ? "" : "−"}${Math.abs(edits.straighten).toFixed(1)}°`, undo: { op: "straighten", degrees: 0 } };
  const turn: WholeClipEdit | false = edits.turn !== 0 && { name: "Turn", value: `${edits.turn}°`, undo: { op: "turn", degrees: 0 } };
  return [...settings, crop, straighten, turn].filter((edit): edit is WholeClipEdit => Boolean(edit));
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

function describeMark(mark: Mark, photo: boolean) {
  const where = [photo ? null : describeWhen(mark), mark.box && `box ${describeBox(mark.box)}`].filter(Boolean).join(", ");
  return `- ${mark.id}${where ? ` ${where}` : ""}: ${mark.note || "(no note)"}${mark.done ? " (done)" : ""}`;
}

function describeSource(document: MediaDocument) {
  const { source } = document;
  if (!source) {
    return 'No video or photo yet. Name the one to edit, next to this file, with { op: "source", file: "clip.mp4" }, or app_open the video itself; a photo is a .jpg, .png, .webp or .heic. Or list files for the user to play and choose from, such as takes of a sound, with { op: "items", items: [...] }.';
  }
  if (isPhoto(source.file)) return source.probe ? `Photo: ${source.file}, ${source.probe.width}×${source.probe.height}.` : `Photo: ${source.file}, not read yet; app_run probe reads its size.`;
  if (!source.probe) return `Video: ${source.file}, not read yet; app_run probe reads its size, length and frame rate.`;
  const { width, height, fps, duration, audio } = source.probe;
  return `Video: ${source.file}, ${width}×${height}, ${formatFps(fps)} fps, ${formatTime(duration)}, ${audio ? "with sound" : "silent"}.`;
}

function describeResultLength({ source, edits }: MediaDocument) {
  if (!source?.probe || (!edits.trim && edits.cuts.length === 0 && !changesSetting(edits.speed, "speed"))) return "";
  const parts = keptParts(edits, source.probe.duration);
  return ` The result is ${formatTime(resultLength(keptPieces(edits, source.probe.duration)))} long${parts.length > 1 ? `, in ${parts.length} pieces` : ""}.`;
}

const changesFrame = ({ crop, turn, straighten }: Edits) => crop !== null || turn !== 0 || straighten !== 0;

function describeResultFrame({ source, edits }: MediaDocument) {
  if (!source?.probe || !changesFrame(edits)) return "";
  const { width, height } = framed(source.probe, edits, { even: !isPhoto(source.file) }).size;
  return ` Its frame is ${width}×${height}.`;
}

function describeRendered(document: MediaDocument) {
  const { rendered, edits, source } = document;
  if (!source) return null;
  if (!rendered) return `Not rendered yet; app_run render writes ${renderedName(source.file)}.`;
  const current = sameEdits(rendered.edits, edits) ? "with the edits as they are now" : `with older edits (${describeEdits(rendered.edits)}); app_run render renders these`;
  return `Rendered: ${rendered.file}, ${current}.`;
}

const describeItem = ({ file, label }: Item) => `- ${label === fileName(file) ? file : `${label} (${file})`}`;

/** The files in their groups, in the order the user sees them: a group's files together, where its first one is. */
export function groupedItems(items: Item[]) {
  const groups = [...new Set(items.map(({ group }) => group))];
  return groups.map((group) => ({ group, items: items.filter((item) => item.group === group) }));
}

function describeItems(items: Item[]) {
  const listing = groupedItems(items)
    .map(({ group, items }) => [group && `${group}:`, ...items.map(describeItem)].filter(Boolean).join("\n"))
    .join("\n");
  return [
    `Files to choose from, which the user plays or looks at in a grid. When they pick one and write about it, you get "About <label> (<file>): <their words>".\n${listing}`,
    ITEMS_OPERATIONS_HELP,
  ].join("\n\n");
}

/** The document for the agent: the video or photo, the edits the user previews, the marks open first, and how to change them. */
export function describeDocument(document: MediaDocument) {
  if (document.items.length > 0) return describeItems(document.items);
  const marks = [...document.marks].sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at);
  const target = document.source ? renderedName(document.source.file) : "the edited file";
  const photo = document.source !== null && isPhoto(document.source.file);
  return [
    describeSource(document),
    `Edits, which the user sees at once in the preview: ${describeEdits(document.edits)}.${describeResultLength(document)}${describeResultFrame(document)}`,
    describeRendered(document),
    marks.length > 0 ? `Marks the user made, open first:\n${marks.map((mark) => describeMark(mark, photo)).join("\n")}` : "No marks yet.",
    `When your edits are done, run app_run render: it writes ${target} next to the source, in place of the one before, and the user compares it with the source.`,
    photo ? PHOTO_OPERATIONS_HELP : OPERATIONS_HELP,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}
