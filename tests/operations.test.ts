import { describe, expect, test } from "bun:test";
import { checkedDocument, newDocument, renderedName, type MediaDocument } from "../shared/document.ts";
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
    expect(edited.document).toMatchObject({ source: { file: "other.mov", probe: null }, edits: { trim: null, exposure: 0 }, marks: [] });
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

  test("sets the exposure in stops, rounded to a hundredth, from -3 to 3", () => {
    const { document, summaries } = applied(withVideo(), { op: "exposure", ev: 0.4999 }, { op: "exposure", ev: -1.5 }, { op: "exposure", ev: 0 });
    expect(summaries).toEqual(["Set the exposure to +0.50 EV.", "Set the exposure to -1.50 EV.", "Set the exposure back to as shot."]);
    expect(document.edits.exposure).toBe(0);
    expect(refusal(withVideo(), { op: "exposure", ev: 4 })).toBe("ev must be stops from -3 to 3; 0 is as shot.");
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
      { op: "rendered", file: "clip.edited.mp4", edits: { trim: { start: 1, end: 9 }, exposure: 1 } },
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
    expect(() => checkedDocument({ ...document, edits: { trim: null, exposure: 9 } })).toThrow("edits: exposure must be a number from -3 to 3");
    expect(() => checkedDocument({ ...document, marks: [...document.marks, ...document.marks] })).toThrow("two marks have the same id");
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
