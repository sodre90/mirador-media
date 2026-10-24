import { describe, expect, test } from "bun:test";
import { checkedDocument, hasEdits, newDocument, NO_EDITS, renderedName, sameEdits, type Edits, type MediaDocument } from "../shared/document.ts";
import { applyOperation } from "../shared/operations.ts";

const probe = { width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true };

const withVideo = (): MediaDocument => ({ ...newDocument(), source: { file: "clip.mp4", probe } });

/** Applies operations one after another, as Mirador does, keeping each inverse. */
function applied(document: MediaDocument, ...operations: unknown[]) {
  return operations.reduce<{ document: MediaDocument; inverses: unknown[]; summaries: string[] }>(
    (state, operation) => {
      const { document: next, inverse, summary } = applyOperation(state.document, operation);
      return { document: next, inverses: [inverse, ...state.inverses], summaries: [...state.summaries, summary] };
    },
    { document, inverses: [], summaries: [] },
  );
}

const refusal = (document: MediaDocument, operation: unknown) => {
  try {
    applyOperation(document, operation);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("it was not refused");
};

describe("applyOperation", () => {
  test("opens a video, and a second one puts the first one's edits and marks aside", () => {
    const opened = applied(newDocument(), { op: "source", file: "clip.mp4" });
    expect(opened.document.source).toEqual({ file: "clip.mp4", probe: null });
    expect(opened.summaries).toEqual(["Opened clip.mp4."]);
    const edited = applied(withVideo(), { op: "exposure", ev: 1 }, { op: "source", file: "other.mov" });
    expect(edited.document).toMatchObject({ source: { file: "other.mov", probe: null }, edits: NO_EDITS, marks: [] });
    expect(edited.summaries[1]).toBe("Opened other.mov; the edits and marks of clip.mp4 are put aside, and undo brings them back.");
    expect(refusal(withVideo(), { op: "source", file: "clip.mp4" })).toBe("clip.mp4 is the video already.");
  });

  test("trims to a part of the video, within its length, and takes the trim off", () => {
    const { document, summaries } = applied(withVideo(), { op: "trim", start: 5, end: 44 });
    expect(document.edits.trim).toEqual({ start: 5, end: 44 });
    expect(summaries).toEqual(["Trimmed to 0:05.00–0:44.00."]);
    expect(applyOperation(document, { op: "untrim" }).document.edits.trim).toBeNull();
    expect(applyOperation(withVideo(), { op: "trim", start: 80, end: 83.42 }).document.edits.trim).toEqual({ start: 80, end: 83.4 });
    expect(refusal(withVideo(), { op: "trim", start: 5, end: 90 })).toBe("end is past the end: clip.mp4 is 1:23.40 long.");
    expect(refusal(withVideo(), { op: "trim", start: 44, end: 5 })).toBe("The trim's end must come after its start.");
    expect(refusal(withVideo(), { op: "untrim" })).toBe("There is no trim to take off.");
    expect(refusal(newDocument(), { op: "trim", start: 1, end: 2 })).toContain("There is no video yet");
  });

  test("cuts parts out, joining cuts that touch, puts a part back, and refuses to leave nothing", () => {
    const { document, summaries } = applied(withVideo(), { op: "cut", start: 10, end: 12 }, { op: "cut", start: 30, end: 31 }, { op: "cut", start: 11.5, end: 14 }, { op: "uncut", start: 12, end: 13 });
    expect(document.edits.cuts).toEqual([
      { start: 10, end: 12 },
      { start: 13, end: 14 },
      { start: 30, end: 31 },
    ]);
    expect(summaries).toEqual(["Cut 0:10.00–0:12.00 out.", "Cut 0:30.00–0:31.00 out.", "Cut 0:11.50–0:14.00 out.", "Put 0:12.00–0:13.00 back."]);
    expect(refusal(document, { op: "uncut", start: 20, end: 25 })).toBe("Nothing is cut from 0:20.00–0:25.00; the cuts are 0:10.00–0:12.00, 0:13.00–0:14.00, 0:30.00–0:31.00.");
    expect(refusal(withVideo(), { op: "cut", start: 3, end: 2 })).toBe("The cut's end must come after its start.");
    expect(refusal(withVideo(), { op: "cut", start: 0, end: 83.4 })).toBe("That would leave nothing of the video.");
    const trimmed = applied(withVideo(), { op: "cut", start: 5, end: 10 }).document;
    expect(refusal(trimmed, { op: "trim", start: 6, end: 9 })).toBe("That would leave nothing of the video.");
  });

  test("sets the exposure in stops, rounded to a hundredth, from -3 to 3", () => {
    const { document, summaries } = applied(withVideo(), { op: "exposure", ev: 0.4999 }, { op: "exposure", ev: -1.5 }, { op: "exposure", ev: 0 });
    expect(summaries).toEqual(["Set the exposure to +0.50 EV.", "Set the exposure to -1.50 EV.", "Set the exposure back to as shot."]);
    expect(document.edits.exposure).toEqual({ clip: 0, ranges: [] });
    expect(refusal(withVideo(), { op: "exposure", ev: 4 })).toBe("ev must be stops from -3 to 3; 0 is as shot.");
  });

  test("sets the speed and the volume for the whole clip, and refuses them outside what they take", () => {
    const { document, summaries } = applied(withVideo(), { op: "speed", rate: 0.5 }, { op: "volume", level: 1.5 }, { op: "volume", level: 1 });
    expect(document.edits.speed).toEqual({ clip: 0.5, ranges: [] });
    expect(summaries).toEqual(["Set the speed to 0.5×.", "Set the volume to 150%.", "Set the volume back to as recorded."]);
    expect(refusal(withVideo(), { op: "speed", rate: 8 })).toBe("rate must be from 0.25 to 4; below 1 is slower and 1 is as shot.");
    expect(refusal(withVideo(), { op: "volume", level: -1 })).toBe("level must be from 0 to 4; 0 mutes and 1 is as recorded.");
    const silent: MediaDocument = { ...newDocument(), source: { file: "clip.webm", probe: { ...probe, audio: false } } };
    expect(refusal(silent, { op: "volume", level: 0 })).toBe("clip.webm has no sound.");
  });

  test("gives a range its own value, which replaces what was set there before, and takes ranges off again", () => {
    const { document, summaries } = applied(
      withVideo(),
      { op: "speed", rate: 0.5, start: 10, end: 20 },
      { op: "speed", rate: 2, start: 12, end: 15 },
      { op: "volume", level: 0, start: 30, end: 40 },
      { op: "clear", edit: "speed", start: 18, end: 25 },
    );
    expect(document.edits.speed.ranges).toEqual([
      { start: 10, end: 12, value: 0.5 },
      { start: 12, end: 15, value: 2 },
      { start: 15, end: 18, value: 0.5 },
    ]);
    expect(summaries).toEqual([
      "Set the speed to 0.5× from 0:10.00 to 0:20.00.",
      "Set the speed to 2× from 0:12.00 to 0:15.00.",
      "Set the volume to 0% (muted) from 0:30.00 to 0:40.00.",
      "The speed from 0:18.00 to 0:25.00 is the whole clip's again.",
    ]);
    expect(applyOperation(document, { op: "clear", edit: "volume" }).document.edits.volume).toEqual({ clip: 1, ranges: [] });
    expect(refusal(document, { op: "clear", edit: "exposure" })).toBe("The exposure has no range of its own to take off.");
    expect(refusal(document, { op: "clear", edit: "speed", start: 50, end: 60 })).toBe("The speed has no range of its own from 0:50.00 to 1:00.00.");
    expect(refusal(document, { op: "clear", edit: "blur" })).toBe("edit is one of exposure, speed, volume.");
    expect(refusal(withVideo(), { op: "exposure", ev: 1, start: 10 })).toBe("Give a range both start and end, or neither for the whole clip.");
    expect(refusal(withVideo(), { op: "exposure", ev: 1, start: 10, end: 90 })).toBe("end is past the end: clip.mp4 is 1:23.40 long.");
  });

  test("crops to a box in whole source pixels kept inside the frame, turns by quarter turns and straightens by up to 45°", () => {
    const { document, summaries } = applied(
      withVideo(),
      { op: "crop", x: 100.4, y: -20, width: 640, height: 500 },
      { op: "turn", degrees: -90 },
      { op: "straighten", degrees: -4.26 },
    );
    expect(document.edits).toMatchObject({ crop: { x: 100, y: 0, width: 640, height: 480 }, turn: 270, straighten: -4.3 });
    expect(summaries).toEqual(["Cropped to x 100, y 0, 640×480 px.", "Turned 270° clockwise.", "Straightened 4.3° anticlockwise."]);
    const undone = applied(document, { op: "uncrop" }, { op: "turn", degrees: 360 }, { op: "straighten", degrees: 0 });
    expect(undone.document.edits).toEqual(NO_EDITS);
    expect(undone.summaries).toEqual(["Took the crop off.", "Turned back to as shot.", "Took the straightening off."]);
    expect(refusal(withVideo(), { op: "uncrop" })).toBe("There is no crop to take off.");
    expect(refusal(withVideo(), { op: "crop", x: 0, y: 0, width: 1, height: 100 })).toBe("A crop keeps at least 2×2 px.");
    expect(refusal(withVideo(), { op: "turn", degrees: 45 })).toBe("degrees must be a quarter turn clockwise: 90, 180 or 270, or 0 for as shot.");
    expect(refusal(withVideo(), { op: "straighten", degrees: 50 })).toBe("degrees must be from -45 to 45: clockwise, or anticlockwise below 0.");
  });

  test("marks a moment, a range and a box in whole source pixels kept inside the frame, numbering them for good", () => {
    const { document, summaries } = applied(
      withVideo(),
      { op: "mark", at: 39.2, box: { x: 120.4, y: 79.6, width: 440, height: 320 }, note: " too dark here " },
      { op: "mark", at: 10, end: 12.5, note: "music too loud" },
      { op: "remove-mark", mark: "m2" },
      { op: "mark", at: 70, box: { x: 1800, y: -10, width: 400, height: 100 }, note: "corner" },
    );
    expect(document.marks).toEqual([
      { id: "m1", at: 39.2, end: null, box: { x: 120, y: 80, width: 440, height: 320 }, note: "too dark here", done: false },
      { id: "m3", at: 70, end: null, box: { x: 1800, y: 0, width: 120, height: 90 }, note: "corner", done: false },
    ]);
    expect(summaries[0]).toBe("Marked m1 at 0:39.20, in the box x 120, y 80, 440×320 px: too dark here");
    expect(summaries[1]).toBe("Marked m2 from 0:10.00 to 0:12.50: music too loud");
    expect(refusal(withVideo(), { op: "mark", at: 5, box: { x: 2000, y: 0, width: 10, height: 10 }, note: "" })).toBe("The box is outside the 1920×1080 frame, or has no size.");
    expect(refusal(withVideo(), { op: "mark", at: 5, end: 4, note: "" })).toBe("A range's end must come after its start.");
  });

  test("ticks a mark off and opens it again, and names the marks there are when one isn't", () => {
    const marked = applied(withVideo(), { op: "mark", at: 1, note: "a" }, { op: "mark-done", mark: "m1" });
    expect(marked.document.marks[0]!.done).toBe(true);
    expect(marked.summaries[1]).toBe("Marked m1 done.");
    expect(applyOperation(marked.document, { op: "mark-done", mark: "m1", done: false }).summary).toBe("Opened m1 again.");
    expect(refusal(marked.document, { op: "mark-done", mark: "m9" })).toBe("There is no mark m9; the marks are m1.");
  });

  test("every operation's inverse puts the document back as it was", () => {
    const start = withVideo();
    const { document, inverses } = applied(
      start,
      { op: "trim", start: 1, end: 9 },
      { op: "exposure", ev: 1 },
      { op: "mark", at: 2, note: "x" },
      { op: "mark-done", mark: "m1" },
      { op: "cut", start: 3, end: 4 },
      { op: "speed", rate: 2, start: 5, end: 6 },
      { op: "clear", edit: "speed" },
      { op: "crop", x: 10, y: 10, width: 100, height: 100 },
      { op: "turn", degrees: 90 },
      { op: "straighten", degrees: 3 },
      { op: "rendered", file: "clip.edited.mp4", edits: { ...NO_EDITS, trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }] } },
      { op: "source", file: "b.mp4" },
    );
    expect(applied(document, ...inverses).document).toEqual(start);
  });

  test("refuses an operation it doesn't know, and a restore of a field it doesn't keep", () => {
    expect(refusal(withVideo(), { op: "blur" })).toBe("There is no operation blur; app_state lists them.");
    expect(refusal(withVideo(), { op: "restore", fields: { version: 2 } })).toBe("restore puts back source, edits, marks, nextMark, rendered.");
    expect(refusal(withVideo(), "trim")).toContain("An operation is an object with op");
  });
});

describe("checkedDocument", () => {
  test("reads what serialize wrote, and says what is wrong with a file that isn't a media document", () => {
    const document = applied(withVideo(), { op: "mark", at: 3, box: { x: 1, y: 2, width: 3, height: 4 }, note: "n" }).document;
    expect(checkedDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(() => checkedDocument({ version: 2 })).toThrow("not a media document: it needs version 1");
    expect(() => checkedDocument({ ...document, edits: { trim: null, exposure: 9 } })).toThrow("edits.exposure must be from -3 to 3");
    expect(() => checkedDocument({ ...document, edits: { ...NO_EDITS, speed: { clip: 1, ranges: [{ start: 1, end: 2, value: 9 }] } } })).toThrow("edits.speed must be from 0.25 to 4, in its ranges too");
    expect(() => checkedDocument({ ...document, marks: [...document.marks, ...document.marks] })).toThrow("two marks have the same id");
    expect(() => checkedDocument({ ...document, edits: { ...document.edits, cuts: [{ start: 5, end: 6 }, { start: 1, end: 2 }] } })).toThrow("edits: cuts must be in order, none overlapping");
  });

  test("reads a document from before cuts, speed and volume existed, whose exposure was one number", () => {
    const older = { ...withVideo(), edits: { trim: { start: 1, end: 9 }, exposure: 1 }, rendered: { file: "clip.edited.mp4", edits: { trim: null, exposure: 1 }, at: 1 } };
    const read = checkedDocument(JSON.parse(JSON.stringify(older)));
    const brighter = { clip: 1, ranges: [] };
    expect(read.edits).toEqual({ ...NO_EDITS, trim: { start: 1, end: 9 }, exposure: brighter });
    expect(read.rendered!.edits).toEqual({ ...NO_EDITS, exposure: brighter });
  });
});

describe("sameEdits", () => {
  test("compares every field, whatever order its keys are in", () => {
    const edits = { ...NO_EDITS, trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }] };
    const reordered: Edits = { straighten: 0, turn: 0, crop: null, volume: NO_EDITS.volume, speed: NO_EDITS.speed, exposure: { ranges: [], clip: 0 }, cuts: [{ end: 4, start: 3 }], trim: { end: 9, start: 1 } };
    expect(sameEdits(edits, reordered)).toBe(true);
    expect(sameEdits(edits, { ...edits, turn: 90 })).toBe(false);
    expect(sameEdits(edits, { ...edits, speed: { clip: 1, ranges: [{ start: 1, end: 2, value: 2 }] } })).toBe(false);
    expect(sameEdits(edits, { ...edits, cuts: [] })).toBe(false);
    expect(hasEdits(NO_EDITS)).toBe(false);
    expect(hasEdits({ ...NO_EDITS, straighten: 1 })).toBe(true);
    expect(hasEdits({ ...NO_EDITS, cuts: [{ start: 1, end: 2 }] })).toBe(true);
  });
});

describe("renderedName", () => {
  test("puts .edited before the extension, and keeps WebM as WebM but makes everything else MP4", () => {
    expect(renderedName("clip.mp4")).toBe("clip.edited.mp4");
    expect(renderedName("shots/Day 1.MOV")).toBe("shots/Day 1.edited.mp4");
    expect(renderedName("clip.webm")).toBe("clip.edited.webm");
    expect(renderedName("noextension")).toBe("noextension.edited.mp4");
  });
});
