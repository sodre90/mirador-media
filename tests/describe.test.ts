import { describe, expect, test } from "bun:test";
import { describeDocument, describeEdits, OPERATIONS_HELP } from "../shared/describe.ts";
import { newDocument, NO_EDITS, type MediaDocument } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { formatTime, frameAt, frameMiddle } from "../shared/time.ts";

const probe = { width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true };

describe("describeDocument", () => {
  test("a document with no video tells the agent how to name one", () => {
    expect(describeDocument(newDocument())).toStartWith('No video yet. Name the one to edit, next to this file, with { op: "source", file: "clip.mp4" }.');
  });

  test("names the video, the edits the user previews, how the render stands, the marks open first, and the operations", () => {
    const document: MediaDocument = {
      ...newDocument(),
      source: { file: "clip.mp4", probe },
      edits: { ...NO_EDITS, trim: { start: 5, end: 44 }, cuts: [{ start: 12, end: 15 }], exposure: { clip: 0.5, ranges: [] }, speed: { clip: 1, ranges: [{ start: 20, end: 22, value: 0.5 }] } },
      marks: [
        { id: "m1", at: 10, end: 12.5, box: null, note: "music too loud", done: true },
        { id: "m2", at: 39.2, end: null, box: { x: 120, y: 80, width: 440, height: 320 }, note: "too dark here", done: false },
      ],
      nextMark: 3,
      rendered: { file: "clip.edited.mp4", edits: { ...NO_EDITS, exposure: { clip: 0.5, ranges: [] } }, at: 1 },
    };
    expect(describeDocument(document)).toBe(
      [
        "Video: clip.mp4, 1920×1080, 29.97 fps, 1:23.40, with sound.",
        "Edits, which the user sees at once in the preview: trim 0:05.00–0:44.00; cut 0:12.00–0:15.00; exposure +0.50 EV; speed 0.5× from 0:20.00 to 0:22.00. The result is 0:38.00 long, in 2 pieces.",
        "Rendered: clip.edited.mp4, with older edits (exposure +0.50 EV); app_run render renders these.",
        "Marks the user made, open first:\n- m2 at 0:39.20, box x 120, y 80, 440×320 px: too dark here\n- m1 from 0:10.00 to 0:12.50: music too loud (done)",
        "When your edits are done, run app_run render: it writes clip.edited.mp4 next to the source, in place of the one before, and the user compares it with the source.",
        OPERATIONS_HELP,
      ].join("\n\n"),
    );
  });

  test("names each setting's clip value and its ranges, and the volume as a share of the recording", () => {
    const edits = {
      ...NO_EDITS,
      exposure: { clip: 1, ranges: [{ start: 40, end: 42, value: 2 }] },
      volume: { clip: 1.5, ranges: [{ start: 38, end: 42, value: 0 }] },
    };
    expect(describeEdits(edits)).toBe("exposure +1.00 EV, +2.00 EV from 0:40.00 to 0:42.00; volume 150%, 0% (muted) from 0:38.00 to 0:42.00");
  });

  test("names the crop, the straightening and the turn, and the size of the frame they make", () => {
    const edits = { ...NO_EDITS, crop: { x: 101, y: 0, width: 1281, height: 721 }, straighten: -2.5, turn: 90 as const };
    const described = describeDocument({ ...newDocument(), source: { file: "clip.mp4", probe }, edits });
    expect(described).toContain("Edits, which the user sees at once in the preview: crop x 101, y 0, 1281×721 px; straightened 2.5° anticlockwise; turned 90° clockwise. Its frame is 720×1280.");
  });

  test("says when the video hasn't been read yet, and when nothing is rendered", () => {
    const described = describeDocument({ ...newDocument(), source: { file: "clip.webm", probe: null } });
    expect(described).toContain("Video: clip.webm, not read yet; app_run probe reads its size, length and frame rate.");
    expect(described).toContain("Edits, which the user sees at once in the preview: none.");
    expect(described).toContain("Not rendered yet; app_run render writes clip.edited.webm.");
  });
});

describe("markMessage", () => {
  test("gives the file, the time with its frame, the box in source pixels and what the picture shows", () => {
    const mark = { id: "m3", at: 39.2, end: null, box: { x: 120, y: 80, width: 440, height: 320 }, note: "too dark here" };
    expect(markMessage("clip.mp4", probe, mark, { exposure: 0.5, frame: NO_EDITS }, 39.2)).toBe(
      "In clip.mp4 at 0:39.20 (frame 1174), in the box x 120, y 80, 440×320 px of the 1920×1080 frame: too dark here\n\n" +
        "(Mark m3. The picture is the frame at 0:39.20 with the box drawn on it in red, as the preview shows it, at exposure +0.50 EV.)",
    );
  });

  test("gives a range with its frames, and a frame as shot", () => {
    const mark = { id: "m1", at: 10, end: 12.5, box: null, note: "music too loud" };
    expect(markMessage("clip.mp4", probe, mark, { exposure: 0, frame: NO_EDITS }, 12.5)).toBe(
      "In clip.mp4 from 0:10.00 to 0:12.50 (frames 299–374): music too loud\n\n(Mark m1. The picture is the frame at 0:12.50, as shot.)",
    );
  });

  test("says the picture is the whole frame when the preview crops, straightens or turns it", () => {
    const mark = { id: "m2", at: 5, end: null, box: null, note: "tilted" };
    const shown = (frame: Partial<typeof NO_EDITS>) => markMessage("clip.mp4", probe, mark, { exposure: 0, frame: { ...NO_EDITS, ...frame } }, 5);
    expect(shown({ turn: 90 })).toEndWith("(Mark m2. The picture is the frame at 0:05.00, as shot. It is the whole frame, before the turn.)");
    expect(shown({ crop: { x: 0, y: 0, width: 10, height: 10 }, straighten: 2, turn: 180 })).toEndWith("It is the whole frame, before the crop, the straightening and the turn.)");
  });
});

describe("time", () => {
  test("formats seconds to the hundredth, with hours when there are some", () => {
    expect([formatTime(0), formatTime(39.2), formatTime(83.399), formatTime(3723.5), formatTime(-1)]).toEqual(["0:00.00", "0:39.20", "1:23.40", "1:02:03.50", "0:00.00"]);
  });

  test("counts frames from 0, and seeks to a frame's middle", () => {
    expect([frameAt(0, 30), frameAt(1 / 30, 30), frameAt(0.999, 30), frameAt(2, 25)]).toEqual([0, 1, 29, 50]);
    expect(frameAt(frameMiddle(41, 29.97), 29.97)).toBe(41);
  });
});
