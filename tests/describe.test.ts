import { describe, expect, test } from "bun:test";
import { describeDocument, describeEdits, OPERATIONS_HELP, PHOTO_OPERATIONS_HELP, wholeClipEdits } from "../shared/describe.ts";
import { newDocument, NO_EDITS, type MediaDocument } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation } from "../shared/operations.ts";
import { formatTime, frameAt, frameMiddle } from "../shared/time.ts";

const probe = { width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true };

describe("describeDocument", () => {
  test("a document with no video tells the agent how to name one, or a photo", () => {
    expect(describeDocument(newDocument())).toStartWith('No video or photo yet. Name the one to edit, next to this file, with { op: "source", file: "clip.mp4" }; a photo is a .jpg, .png or .webp.');
  });

  test("names a photo and its size, its marks without a time, and only the operations a photo takes", () => {
    const photo = { width: 4032, height: 3024, duration: 0, fps: 0, audio: false };
    const document: MediaDocument = {
      ...newDocument(),
      source: { file: "IMG_1.JPG", probe: photo },
      edits: { ...NO_EDITS, exposure: { clip: 0.5, ranges: [] }, turn: 90 },
      marks: [{ id: "m1", at: 0, end: null, box: { x: 10, y: 20, width: 300, height: 200 }, note: "tilted", done: false }],
      nextMark: 2,
    };
    expect(describeDocument(document)).toBe(
      [
        "Photo: IMG_1.JPG, 4032×3024.",
        "Edits, which the user sees at once in the preview: exposure +0.50 EV; turned 90° clockwise. Its frame is 3024×4032.",
        "Not rendered yet; app_run render writes IMG_1.edited.JPG.",
        "Marks the user made, open first:\n- m1 box x 10, y 20, 300×200 px: tilted",
        "When your edits are done, run app_run render: it writes IMG_1.edited.JPG next to the source, in place of the one before, and the user compares it with the source.",
        PHOTO_OPERATIONS_HELP,
      ].join("\n\n"),
    );
    expect(PHOTO_OPERATIONS_HELP).not.toMatch(/trim|speed|volume|at:/);
    expect(describeDocument({ ...newDocument(), source: { file: "shot.png", probe: null } })).toStartWith("Photo: shot.png, not read yet; app_run probe reads its size.");
  });

  test("gives a photo's crop its exact size, where a video's is made even", () => {
    const crop = { x: 0, y: 0, width: 201, height: 151 };
    const framing = (file: string) => describeDocument({ ...newDocument(), source: { file, probe: { ...probe, fps: file.endsWith(".png") ? 0 : 30 } }, edits: { ...NO_EDITS, crop } });
    expect(framing("shot.png")).toContain("Its frame is 201×151.");
    expect(framing("clip.mp4")).toContain("Its frame is 200×150.");
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

describe("wholeClipEdits", () => {
  test("lists what changes the whole picture, each with the operation that takes it off, and leaves ranges to the timeline", () => {
    const edits = { ...NO_EDITS, exposure: { clip: 0.5, ranges: [{ start: 1, end: 2, value: 2 }] }, speed: { clip: 1, ranges: [{ start: 3, end: 4, value: 2 }] }, volume: { clip: 0, ranges: [] }, crop: { x: 10, y: 20, width: 1600, height: 900 }, straighten: -1.5, turn: 90 as const };
    expect(wholeClipEdits(edits)).toEqual([
      { name: "Exposure", value: "+0.50 EV", undo: { op: "exposure", ev: 0 } },
      { name: "Volume", value: "0% (muted)", undo: { op: "volume", level: 1 } },
      { name: "Crop", value: "1600×900", undo: { op: "uncrop" } },
      { name: "Straighten", value: "−1.5°", undo: { op: "straighten", degrees: 0 } },
      { name: "Turn", value: "90°", undo: { op: "turn", degrees: 0 } },
    ]);
    expect(wholeClipEdits(NO_EDITS)).toEqual([]);
  });

  test("each undo puts the edit back as shot and keeps the ranges", () => {
    const source = { file: "clip.mp4", probe: { width: 1920, height: 1080, duration: 60, fps: 30, audio: true } };
    const operations = [{ op: "exposure", ev: 1 }, { op: "exposure", ev: 2, start: 1, end: 2 }, { op: "speed", rate: 2 }, { op: "crop", x: 0, y: 0, width: 100, height: 100 }, { op: "straighten", degrees: 3 }, { op: "turn", degrees: 180 }];
    const edited = operations.reduce((document, operation) => applyOperation(document, operation).document, { ...newDocument(), source } as MediaDocument);
    const undone = wholeClipEdits(edited.edits).reduce((document, { undo }) => applyOperation(document, undo).document, edited);
    expect(undone.edits).toEqual({ ...NO_EDITS, exposure: { clip: 0, ranges: [{ start: 1, end: 2, value: 2 }] } });
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

  test("says where on a photo, with no time, and that the picture is the whole photo", () => {
    const photo = { width: 4032, height: 3024, duration: 0, fps: 0, audio: false };
    const mark = { id: "m1", at: 0, end: null, box: { x: 10, y: 20, width: 300, height: 200 }, note: "sky too bright" };
    expect(markMessage("IMG_1.JPG", photo, mark, { exposure: -1, frame: { ...NO_EDITS, turn: 90 } }, 0)).toBe(
      "In IMG_1.JPG, in the box x 10, y 20, 300×200 px of the 4032×3024 photo: sky too bright\n\n" +
        "(Mark m1. The picture is the photo with the box drawn on it in red, as the preview shows it, at exposure -1.00 EV. It is the whole frame, before the turn.)",
    );
    expect(markMessage("shot.png", photo, { ...mark, box: null }, { exposure: 0, frame: NO_EDITS }, 0)).toBe("In shot.png: sky too bright\n\n(Mark m1. The picture is the photo, as shot.)");
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
