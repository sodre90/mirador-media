import type { Turn } from "./geometry.ts";

/** A video and what the user and the agent do with it: the source file stays as it was, the edits are a list kept here. */
export interface MediaDocument {
  version: 1;
  /** Null until the agent names the video next to this file. */
  source: Source | null;
  edits: Edits;
  marks: Mark[];
  /** The number the next mark gets, so a removed mark's id is never reused. */
  nextMark: number;
  rendered: Rendered | null;
}

export interface Source {
  /** Relative to the document's folder. */
  file: string;
  /** What ffprobe read, once the probe task ran. */
  probe: Probe | null;
}

/** The size is as the picture is shown, a phone's rotation taken into account. A photo lasts 0 s at 0 fps, silent. */
export interface Probe {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  fps: number;
  audio: boolean;
}

/** A part of the source, in seconds. */
export interface Span {
  start: number;
  end: number;
}

/** A part of the source where a setting has a value of its own. */
export interface Ranged extends Span {
  value: number;
}

/** A setting's value for the whole clip, and the parts, in order and none overlapping, where a value of their own replaces it. */
export interface Setting {
  clip: number;
  ranges: Ranged[];
}

export interface Edits {
  /** The part of the source to keep. */
  trim: Span | null;
  /** Parts taken out of what the trim keeps, in order, none overlapping. */
  cuts: Span[];
  /** Stops brighter, or darker below 0. */
  exposure: Setting;
  /** How many times as fast as shot it plays. */
  speed: Setting;
  /** How many times as loud as recorded; 0 is muted. */
  volume: Setting;
  /** The part of the frame to keep, in the source's pixels. */
  crop: Box | null;
  turn: Turn;
  /** Degrees clockwise, inside the crop. */
  straighten: number;
}

export const MAX_STRAIGHTEN = 45;

export type SettingName = "exposure" | "speed" | "volume";

export const SETTINGS: Record<SettingName, { least: number; most: number; asShot: number }> = {
  exposure: { least: -3, most: 3, asShot: 0 },
  speed: { least: 0.25, most: 4, asShot: 1 },
  volume: { least: 0, most: 4, asShot: 1 },
};

export const SETTING_NAMES = Object.keys(SETTINGS) as SettingName[];

/** A rectangle of the frame, in the source's pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A moment or a range the user pointed at, maybe a box on its frame, and what they said about it. */
export interface Mark {
  id: string;
  /** Seconds into the source. */
  at: number;
  end: number | null;
  box: Box | null;
  note: string;
  done: boolean;
}

export interface Rendered {
  /** Relative to the document's folder. */
  file: string;
  /** The edits it was rendered with. */
  edits: Edits;
  at: number;
}

const asShot = (name: SettingName): Setting => ({ clip: SETTINGS[name].asShot, ranges: [] });

export const NO_EDITS: Edits = { trim: null, cuts: [], exposure: asShot("exposure"), speed: asShot("speed"), volume: asShot("volume"), crop: null, turn: 0, straighten: 0 };

/** A new document, on the video or photo app_open was given for it when there is one. */
export const newDocument = (sourceFile?: string): MediaDocument => ({ version: 1, source: sourceFile ? { file: sourceFile, probe: null } : null, edits: NO_EDITS, marks: [], nextMark: 1, rendered: null });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNonNegative = (value: unknown): value is number => isNumber(value) && value >= 0;

class DocumentProblem extends Error {}

function check(condition: unknown, problem: string): asserts condition {
  if (!condition) throw new DocumentProblem(problem);
}

function checkedBox(value: unknown, where: string): Box | null {
  if (value === null) return null;
  check(isRecord(value), `${where}: a box needs x, y, width and height`);
  const { x, y, width, height } = value;
  check(isNonNegative(x) && isNonNegative(y) && isNumber(width) && isNumber(height) && width > 0 && height > 0, `${where}: a box needs x and y of 0 or more, and a width and height above 0`);
  return { x, y, width, height };
}

function checkedSpan(value: unknown, where: string): Span {
  check(isRecord(value) && isNonNegative(value.start) && isNonNegative(value.end) && value.end > value.start, `${where} needs a start of 0 or more and an end after it`);
  return { start: value.start, end: value.end };
}

const inOrder = (spans: Span[]) => spans.every((span, index) => index === 0 || span.start >= spans[index - 1]!.end);

function checkedSetting(value: unknown, name: SettingName, where: string): Setting {
  const { least, most } = SETTINGS[name];
  const allowed = (number: unknown): number is number => isNumber(number) && number >= least && number <= most;
  const problem = `${where}.${name} must be from ${least} to ${most}`;
  if (isNumber(value)) {
    check(allowed(value), problem);
    return { clip: value, ranges: [] };
  }
  check(isRecord(value) && allowed(value.clip) && Array.isArray(value.ranges), `${where}.${name} needs its clip value, ${least} to ${most}, and its ranges`);
  const ranges = value.ranges.map((range, index) => {
    const span = checkedSpan(range, `${where}.${name}.ranges[${index}]`);
    check(allowed((range as Ranged).value), `${problem}, in its ranges too`);
    return { ...span, value: (range as Ranged).value };
  });
  check(inOrder(ranges), `${where}.${name}: its ranges must be in order, none overlapping`);
  return { clip: value.clip, ranges };
}

/** Edits from before a field existed read as that field left as shot, and a setting that was one number as that clip value. */
function checkedEdits(value: unknown, where: string): Edits {
  check(isRecord(value), `${where} needs trim and exposure`);
  const { trim = null, cuts = [], crop = null, turn = 0, straighten = 0 } = value;
  check(turn === 0 || turn === 90 || turn === 180 || turn === 270, `${where}: turn must be 0, 90, 180 or 270`);
  check(isNumber(straighten) && Math.abs(straighten) <= MAX_STRAIGHTEN, `${where}: straighten must be degrees from -${MAX_STRAIGHTEN} to ${MAX_STRAIGHTEN}`);
  check(Array.isArray(cuts), `${where}: cuts must be a list`);
  const checkedCuts = cuts.map((cut, index) => checkedSpan(cut, `${where}.cuts[${index}]`));
  check(inOrder(checkedCuts), `${where}: cuts must be in order, none overlapping`);
  const settings = Object.fromEntries(SETTING_NAMES.map((name) => [name, value[name] === undefined ? asShot(name) : checkedSetting(value[name], name, where)])) as Record<SettingName, Setting>;
  return { trim: trim === null ? null : checkedSpan(trim, `${where}.trim`), cuts: checkedCuts, ...settings, crop: checkedBox(crop, `${where}.crop`), turn, straighten };
}

/** HEIC and HEIF photos, an iPhone's own: no browser shows them. */
export const isHeif = (file: string) => /\.(heic|heif)$/i.test(file);

/** Photos the view shows in an img, and the render writes in their own format, or a HEIF photo as JPEG. */
export const isPhoto = (file: string) => /\.(jpe?g|png|webp)$/i.test(file) || isHeif(file);

const isVideo = (file: string) => /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file);

/**
 * The document for a video or photo app_open is given: clip.mp4 has clip.media.json beside it; null for a document
 * itself. A video and a photo of the same name share one, whose source says which it edits.
 */
export function mediaDocumentFor(file: string): string | null {
  if (/\.media\.json$/i.test(file)) return null;
  if (!isVideo(file) && !isPhoto(file)) throw new Error(`${file} isn't a video or photo; open a .mp4, .mov, .webm, .jpg, .png, .webp or .heic, or a .media.json`);
  return file.replace(/\.[^./]+$/, ".media.json");
}

/** The PNG decoded from a HEIF photo, hidden beside it, which the view shows and the render reads: IMG_1.heic has .IMG_1.heic.png. */
export const standInName = (source: string) => source.replace(/([^/]+)$/, ".$1.png");

/** The file the view shows of the source: a HEIF photo's stand-in once the probe has made it, else the source itself. */
export const shownFile = (source: Source) => (isHeif(source.file) ? (source.probe ? standInName(source.file) : null) : source.file);

function checkedSource(value: unknown): Source | null {
  if (value === null) return null;
  check(isRecord(value) && typeof value.file === "string" && value.file !== "", "source needs the video's or photo's file");
  if (value.probe === null) return { file: value.file, probe: null };
  const probe = value.probe;
  check(isRecord(probe), "source.probe needs the video's size, duration, fps and audio");
  const { width, height, duration, fps, audio } = probe;
  check(isNumber(width) && isNumber(height) && width > 0 && height > 0, "source.probe needs a width and height above 0");
  check(isNonNegative(duration) && isNumber(fps) && (fps > 0 || isPhoto(value.file)) && typeof audio === "boolean", "source.probe needs a duration, an fps above 0 and whether it has sound");
  return { file: value.file, probe: { width, height, duration, fps, audio } };
}

function checkedMark(value: unknown, index: number): Mark {
  const where = `marks[${index}]`;
  check(isRecord(value) && typeof value.id === "string" && isNonNegative(value.at), `${where} needs an id and the seconds it is at`);
  const end = value.end ?? null;
  check(end === null || (isNonNegative(end) && end > value.at), `${where}: a range's end must come after its start`);
  check(typeof value.note === "string" && typeof value.done === "boolean", `${where} needs a note and whether it is done`);
  return { id: value.id, at: value.at, end, box: checkedBox(value.box ?? null, where), note: value.note, done: value.done };
}

/** The document a file holds, or the reason it isn't one. */
export function checkedDocument(value: unknown): MediaDocument {
  check(isRecord(value) && value.version === 1, "not a media document: it needs version 1");
  check(Array.isArray(value.marks), "marks must be a list");
  check(Number.isInteger(value.nextMark) && (value.nextMark as number) >= 1, "nextMark must be a whole number from 1");
  const marks = value.marks.map(checkedMark);
  check(new Set(marks.map(({ id }) => id)).size === marks.length, "two marks have the same id");
  const rendered = value.rendered ?? null;
  check(rendered === null || (isRecord(rendered) && typeof rendered.file === "string" && isNumber(rendered.at)), "rendered needs the file and when it was rendered");
  return {
    version: 1,
    source: checkedSource(value.source ?? null),
    edits: checkedEdits(value.edits, "edits"),
    marks,
    nextMark: value.nextMark as number,
    rendered: rendered && { file: rendered.file as string, edits: checkedEdits(rendered.edits, "rendered.edits"), at: rendered.at as number },
  };
}

/** Compares every field, so one added later can't be left out of whether a render is current. */
export const sameEdits = (a: Edits, b: Edits) => JSON.stringify(checkedEdits(a, "edits")) === JSON.stringify(checkedEdits(b, "edits"));

export const hasEdits = (edits: Edits) => !sameEdits(edits, NO_EDITS);

/** The value a setting has at a moment of the source. */
export const settingAt = ({ clip, ranges }: Setting, time: number) => ranges.find(({ start, end }) => time >= start && time < end)?.value ?? clip;

export const changesSetting = (setting: Setting, name: SettingName) => setting.clip !== SETTINGS[name].asShot || setting.ranges.length > 0;

/**
 * The rendered file's name next to the source: clip.mp4 becomes clip.edited.mp4, a WebM stays WebM so every browser plays
 * it, a photo keeps its format, and a HEIF photo becomes a JPEG, which every browser shows.
 */
export function renderedName(source: string) {
  const extension = isHeif(source) ? ".jpg" : isPhoto(source) ? /\.[^./]+$/.exec(source)![0] : /\.webm$/i.test(source) ? ".webm" : ".mp4";
  const stem = source.replace(/\.[^./]+$/, "");
  return `${stem}.edited${extension}`;
}
