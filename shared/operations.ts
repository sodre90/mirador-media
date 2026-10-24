import { checkedDocument, hasEdits, MAX_EXPOSURE, NO_EDITS, type Box, type Edits, type MediaDocument, type Probe } from "./document.ts";
import { overlaps, withoutSpan, withSpan } from "./spans.ts";
import { keptPieces } from "./timeline.ts";
import { formatExposure, formatTime } from "./time.ts";

export type Operation =
  | { op: "source"; file: string }
  | { op: "trim"; start: number; end: number }
  | { op: "untrim" }
  | { op: "cut"; start: number; end: number }
  | { op: "uncut"; start: number; end: number }
  | { op: "exposure"; ev: number }
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
  if (duration !== undefined && keptPieces(edits, duration).length === 0) refuse("That would leave nothing of the video.");
  return edits;
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
    case "exposure": {
      sourceOf(document);
      if (!isNumber(operation.ev) || Math.abs(operation.ev) > MAX_EXPOSURE) refuse(`ev must be stops from -${MAX_EXPOSURE} to ${MAX_EXPOSURE}; 0 is as shot.`);
      const ev = roundTo(operation.ev, 2);
      return changed(document, { edits: { ...document.edits, exposure: ev } }, ev === 0 ? "Set the exposure back to as shot." : `Set the exposure to ${formatExposure(ev)}.`, ["edits.exposure"]);
    }
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
