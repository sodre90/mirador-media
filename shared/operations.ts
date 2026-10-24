import { checkedDocument, hasEdits, NO_EDITS, SETTING_NAMES, SETTINGS, type Box, type Edits, type MediaDocument, type Probe, type Ranged, type SettingName } from "./document.ts";
import { overlaps, painted, withoutSpan, withSpan } from "./spans.ts";
import { keptParts } from "./timeline.ts";
import { formatTime, SETTING_FORMATS } from "./time.ts";

export type Operation =
  | { op: "source"; file: string }
  | { op: "trim"; start: number; end: number }
  | { op: "untrim" }
  | { op: "cut"; start: number; end: number }
  | { op: "uncut"; start: number; end: number }
  | { op: "exposure"; ev: number; start?: number; end?: number }
  | { op: "speed"; rate: number; start?: number; end?: number }
  | { op: "volume"; level: number; start?: number; end?: number }
  /** Takes a setting's ranges off, or the parts of them from start to end, so the clip's value holds there again. */
  | { op: "clear"; edit: SettingName; start?: number; end?: number }
  | { op: "mark"; at: number; end?: number | null; box?: Box | null; note: string }
  | { op: "mark-done"; mark: string; done?: boolean }
  | { op: "remove-mark"; mark: string }
  /** What the probe task read. */
  | { op: "probed"; probe: Probe }
  /** What the render task wrote. */
  | { op: "rendered"; file: string; edits: Edits }
  /** Puts fields back as they were: the inverse of every other operation. */
  | { op: "restore"; fields: Partial<Restorable> };

type Restorable = Pick<MediaDocument, "source" | "edits" | "marks" | "nextMark" | "rendered">;

const RESTORABLE: (keyof Restorable)[] = ["source", "edits", "marks", "nextMark", "rendered"];

export interface Applied {
  document: MediaDocument;
  inverse: Operation;
  summary: string;
  touched: string[];
}

/** A frame's worth of slack for a time the user or the agent puts at the very end. */
const END_SLACK_SECONDS = 0.05;

class OperationProblem extends Error {}

function refuse(problem: string): never {
  throw new OperationProblem(problem);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const roundTo = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

function sourceOf(document: MediaDocument) {
  return document.source ?? refuse('There is no video yet; name one next to this file with { op: "source", file: "clip.mp4" }.');
}

/** A time in the source, refused when it is past the end the probe read. */
function secondsIn(document: MediaDocument, value: unknown, name: string) {
  if (!isNumber(value) || value < 0) refuse(`${name} must be seconds from 0.`);
  const duration = document.source?.probe?.duration;
  if (duration !== undefined && value > duration + END_SLACK_SECONDS) refuse(`${name} is past the end: ${document.source!.file} is ${formatTime(duration)} long.`);
  return roundTo(duration === undefined ? value : Math.min(value, duration), 3);
}

/** A part of the source from start to end, each refused as secondsIn refuses it. */
function spanIn(document: MediaDocument, operation: Record<string, unknown>, whose: string) {
  const start = secondsIn(document, operation.start, "start");
  const end = secondsIn(document, operation.end, "end");
  if (end <= start) refuse(`The ${whose} end must come after its start.`);
  return { start, end };
}

/** Refuses edits that would leave nothing of the video, once its length is known. */
function keepingSome(document: MediaDocument, edits: Edits) {
  const duration = document.source?.probe?.duration;
  if (duration !== undefined && keptParts(edits, duration).length === 0) refuse("That would leave nothing of the video.");
  return edits;
}

/** How each setting is given and refused. */
const SETTING_OPERATIONS: Record<SettingName, { field: string; places: number; asShot: string; refusal: string }> = {
  exposure: { field: "ev", places: 2, asShot: "as shot", refusal: "ev must be stops from -3 to 3; 0 is as shot." },
  speed: { field: "rate", places: 3, asShot: "as shot", refusal: "rate must be from 0.25 to 4; below 1 is slower and 1 is as shot." },
  volume: { field: "level", places: 2, asShot: "as recorded", refusal: "level must be from 0 to 4; 0 mutes and 1 is as recorded." },
};

/** The part of the source an operation gives with start and end, or null when it gives neither, for the whole clip. */
function rangeOf(document: MediaDocument, operation: Record<string, unknown>) {
  if (operation.start === undefined && operation.end === undefined) return null;
  if (operation.start === undefined || operation.end === undefined) refuse("Give a range both start and end, or neither for the whole clip.");
  return spanIn(document, operation, "range's");
}

const sameValue = (a: Ranged, b: Ranged) => a.value === b.value;

function setSetting(document: MediaDocument, name: SettingName, operation: Record<string, unknown>): Applied {
  const source = sourceOf(document);
  const { field, places, asShot, refusal } = SETTING_OPERATIONS[name];
  const describe = SETTING_FORMATS[name];
  const given = operation[field];
  if (!isNumber(given) || given < SETTINGS[name].least || given > SETTINGS[name].most) refuse(refusal);
  if (name === "volume" && source.probe?.audio === false) refuse(`${source.file} has no sound.`);
  const value = roundTo(given, places);
  const range = rangeOf(document, operation);
  const setting = document.edits[name];
  const changedSetting = range ? { ...setting, ranges: painted(setting.ranges, range, { ...range, value }, sameValue) } : { ...setting, clip: value };
  const summary = range
    ? `Set the ${name} to ${describe(value)} from ${formatTime(range.start)} to ${formatTime(range.end)}.`
    : value === SETTINGS[name].asShot
      ? `Set the ${name} back to ${asShot}.`
      : `Set the ${name} to ${describe(value)}.`;
  return changed(document, { edits: { ...document.edits, [name]: changedSetting } }, summary, [`edits.${name}`]);
}

function clearSetting(document: MediaDocument, operation: Record<string, unknown>): Applied {
  const name = operation.edit as SettingName;
  if (!SETTING_NAMES.includes(name)) refuse(`edit is one of ${SETTING_NAMES.join(", ")}.`);
  const setting = document.edits[name];
  const range = rangeOf(document, operation);
  const ranges = range ? painted(setting.ranges, range, null, sameValue) : [];
  if (JSON.stringify(ranges) === JSON.stringify(setting.ranges)) {
    refuse(`The ${name} has no range of its own ${range ? `from ${formatTime(range.start)} to ${formatTime(range.end)}` : "to take off"}.`);
  }
  const where = range ? ` from ${formatTime(range.start)} to ${formatTime(range.end)}` : "";
  return changed(document, { edits: { ...document.edits, [name]: { ...setting, ranges } } }, `The ${name}${where} is the whole clip's again.`, [`edits.${name}`]);
}

export const describeSpan = ({ start, end }: { start: number; end: number }) => `${formatTime(start)}–${formatTime(end)}`;

function boxIn(document: MediaDocument, value: unknown): Box | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || ![value.x, value.y, value.width, value.height].every(isNumber)) refuse("A box needs x, y, width and height, in the source's pixels.");
  const probe = document.source?.probe;
  const [x, y] = [Math.max(0, Math.round(value.x as number)), Math.max(0, Math.round(value.y as number))];
  const right = Math.min(probe?.width ?? Infinity, Math.round((value.x as number) + (value.width as number)));
  const bottom = Math.min(probe?.height ?? Infinity, Math.round((value.y as number) + (value.height as number)));
  if (right <= x || bottom <= y) refuse(probe ? `The box is outside the ${probe.width}×${probe.height} frame, or has no size.` : "The box has no size.");
  return { x, y, width: right - x, height: bottom - y };
}

function markOf(document: MediaDocument, id: unknown) {
  const mark = document.marks.find((candidate) => candidate.id === id);
  if (!mark) refuse(`There is no mark ${String(id)}; the marks are ${document.marks.map(({ id }) => id).join(", ") || "none yet"}.`);
  return mark;
}

export const describeBox = ({ x, y, width, height }: Box) => `x ${x}, y ${y}, ${width}×${height} px`;

export const describeWhen = ({ at, end }: { at: number; end: number | null }) => (end === null ? `at ${formatTime(at)}` : `from ${formatTime(at)} to ${formatTime(end)}`);

function changed(document: MediaDocument, fields: Partial<Restorable>, summary: string, touched: string[]): Applied {
  const before = Object.fromEntries(Object.keys(fields).map((key) => [key, document[key as keyof Restorable]])) as Partial<Restorable>;
  return { document: checkedDocument({ ...document, ...fields }), inverse: { op: "restore", fields: before }, summary, touched };
}

/** The document with the operation applied, what undoes it and what it did; an operation that doesn't fit throws why. */
export function applyOperation(document: MediaDocument, operation: unknown): Applied {
  if (!isRecord(operation) || typeof operation.op !== "string") refuse(`An operation is an object with op, e.g. { op: "exposure", ev: 0.5 }.`);
  switch (operation.op) {
    case "source": {
      const { file } = operation;
      if (typeof file !== "string" || file.trim() === "") refuse("source needs the video's file, relative to this file's folder.");
      if (document.source?.file === file) refuse(`${file} is the video already.`);
      const dropped = document.marks.length > 0 || hasEdits(document.edits) ? `; the edits and marks of ${document.source?.file} are put aside, and undo brings them back` : "";
      return changed(document, { source: { file, probe: null }, edits: NO_EDITS, marks: [], rendered: null }, `Opened ${file}${dropped}.`, ["source"]);
    }
    case "trim": {
      sourceOf(document);
      const trim = spanIn(document, operation, "trim's");
      return changed(document, { edits: keepingSome(document, { ...document.edits, trim }) }, `Trimmed to ${describeSpan(trim)}.`, ["edits.trim"]);
    }
    case "untrim":
      if (!document.edits.trim) refuse("There is no trim to take off.");
      return changed(document, { edits: { ...document.edits, trim: null } }, "Took the trim off.", ["edits.trim"]);
    case "cut": {
      sourceOf(document);
      const cut = spanIn(document, operation, "cut's");
      return changed(document, { edits: keepingSome(document, { ...document.edits, cuts: withSpan(document.edits.cuts, cut) }) }, `Cut ${describeSpan(cut)} out.`, ["edits.cuts"]);
    }
    case "uncut": {
      const span = spanIn(document, operation, "part's");
      if (!document.edits.cuts.some((cut) => overlaps(cut, span))) refuse(`Nothing is cut from ${describeSpan(span)}; the cuts are ${document.edits.cuts.map(describeSpan).join(", ") || "none"}.`);
      return changed(document, { edits: { ...document.edits, cuts: withoutSpan(document.edits.cuts, span) } }, `Put ${describeSpan(span)} back.`, ["edits.cuts"]);
    }
    case "exposure":
    case "speed":
    case "volume":
      return setSetting(document, operation.op, operation);
    case "clear":
      return clearSetting(document, operation);
    case "mark": {
      sourceOf(document);
      const at = secondsIn(document, operation.at, "at");
      const end = operation.end === undefined || operation.end === null ? null : secondsIn(document, operation.end, "end");
      if (end !== null && end <= at) refuse("A range's end must come after its start.");
      if (typeof operation.note !== "string") refuse("A mark needs a note: what is wrong there.");
      const mark = { id: `m${document.nextMark}`, at, end, box: boxIn(document, operation.box), note: operation.note.trim(), done: false };
      const where = `${describeWhen(mark)}${mark.box ? `, in the box ${describeBox(mark.box)}` : ""}`;
      return changed(document, { marks: [...document.marks, mark], nextMark: document.nextMark + 1 }, `Marked ${mark.id} ${where}: ${mark.note}`, [`marks.${mark.id}`]);
    }
    case "mark-done": {
      const mark = markOf(document, operation.mark);
      const done = operation.done ?? true;
      if (typeof done !== "boolean") refuse("done is true or false.");
      const marks = document.marks.map((candidate) => (candidate === mark ? { ...mark, done } : candidate));
      return changed(document, { marks }, done ? `Marked ${mark.id} done.` : `Opened ${mark.id} again.`, [`marks.${mark.id}`]);
    }
    case "remove-mark": {
      const mark = markOf(document, operation.mark);
      return changed(document, { marks: document.marks.filter((candidate) => candidate !== mark) }, `Removed ${mark.id}.`, [`marks.${mark.id}`]);
    }
    case "probed": {
      const source = sourceOf(document);
      const { probe } = operation as { probe: Probe };
      const summary = `Read ${source.file}: ${isRecord(probe) ? `${probe.width}×${probe.height}, ${formatTime(probe.duration as number)}` : "?"}.`;
      return changed(document, { source: { ...source, probe } }, summary, ["source"]);
    }
    case "rendered": {
      const { file, edits } = operation as { file: string; edits: Edits };
      return changed(document, { rendered: { file, edits, at: Date.now() } }, `Rendered ${file}.`, ["rendered"]);
    }
    case "restore": {
      if (!isRecord(operation.fields) || !Object.keys(operation.fields).every((key) => RESTORABLE.includes(key as keyof Restorable))) {
        refuse(`restore puts back ${RESTORABLE.join(", ")}.`);
      }
      return changed(document, operation.fields as Partial<Restorable>, "Undid a change.", Object.keys(operation.fields));
    }
    default:
      refuse(`There is no operation ${operation.op}; app_state lists them.`);
  }
}
