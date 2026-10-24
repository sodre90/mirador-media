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

/** The size is as the video is shown, a phone video's rotation taken into account. */
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

export interface Edits {
  /** The part of the source to keep. */
  trim: Span | null;
  /** Parts taken out of what the trim keeps, in order, none overlapping. */
  cuts: Span[];
  /** Stops brighter or darker, from -3 to 3; 0 is as shot. */
  exposure: number;
}

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

export const MAX_EXPOSURE = 3;

export const NO_EDITS: Edits = { trim: null, cuts: [], exposure: 0 };

export const newDocument = (): MediaDocument => ({ version: 1, source: null, edits: NO_EDITS, marks: [], nextMark: 1, rendered: null });

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

/** Edits from before a field existed read as that field left as shot. */
function checkedEdits(value: unknown, where: string): Edits {
  check(isRecord(value), `${where} needs trim and exposure`);
  const { trim = null, cuts = [], exposure } = value;
  check(isNumber(exposure) && Math.abs(exposure) <= MAX_EXPOSURE, `${where}: exposure must be a number from -${MAX_EXPOSURE} to ${MAX_EXPOSURE}`);
  check(Array.isArray(cuts), `${where}: cuts must be a list`);
  const checkedCuts = cuts.map((cut, index) => checkedSpan(cut, `${where}.cuts[${index}]`));
  check(checkedCuts.every((cut, index) => index === 0 || cut.start > checkedCuts[index - 1]!.end), `${where}: cuts must be in order, none overlapping`);
  return { trim: trim === null ? null : checkedSpan(trim, `${where}.trim`), cuts: checkedCuts, exposure };
}

function checkedSource(value: unknown): Source | null {
  if (value === null) return null;
  check(isRecord(value) && typeof value.file === "string" && value.file !== "", "source needs the video's file");
  if (value.probe === null) return { file: value.file, probe: null };
  const probe = value.probe;
  check(isRecord(probe), "source.probe needs the video's size, duration, fps and audio");
  const { width, height, duration, fps, audio } = probe;
  check(isNumber(width) && isNumber(height) && width > 0 && height > 0, "source.probe needs a width and height above 0");
  check(isNonNegative(duration) && isNumber(fps) && fps > 0 && typeof audio === "boolean", "source.probe needs a duration, an fps above 0 and whether it has sound");
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

/** The rendered file's name next to the source: clip.mp4 becomes clip.edited.mp4, and a WebM stays WebM so every browser plays it. */
export function renderedName(source: string) {
  const extension = /\.webm$/i.test(source) ? ".webm" : ".mp4";
  const stem = source.replace(/\.[^./]+$/, "");
  return `${stem}.edited${extension}`;
}
