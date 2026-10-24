import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView } from "../scripts/build-view.ts";
import { NO_EDITS } from "../shared/document.ts";
import { boxBetween, frameOnStage, sourcePoint } from "../view/geometry.ts";
import { formatTick, rulerTicks } from "../view/scale.ts";
import { thumbnailTimes } from "../view/thumbnails.ts";

describe("the frame on the stage", () => {
  const source = { width: 1920, height: 1080 };

  test("is as large as fits, letterboxed in a tall stage and pillarboxed in a wide one", () => {
    expect(frameOnStage({ width: 800, height: 600 }, source, NO_EDITS, { even: true })).toMatchObject({ left: 0, top: 75, width: 800, height: 450 });
    expect(frameOnStage({ width: 1000, height: 450 }, source, NO_EDITS, { even: true })).toMatchObject({ left: 100, top: 0, width: 800, height: 450 });
  });

  test("is the crop's shape, turned, and puts the crop's corner where the turn takes it", () => {
    const frame = frameOnStage({ width: 1000, height: 1000 }, source, { ...NO_EDITS, crop: { x: 960, y: 0, width: 960, height: 540 }, turn: 90 }, { even: true });
    expect([frame.left, frame.top, frame.width, frame.height].map((pixels) => Math.round(pixels * 1e6) / 1e6 + 0)).toEqual([218.75, 0, 562.5, 1000]);
    const cropCorner = sourcePoint(frame, source, 562.5, 0);
    expect(cropCorner.x).toBeCloseTo(960, 6);
    expect(cropCorner.y).toBeCloseTo(0, 6);
  });
});

describe("the box drawn on the screen", () => {
  const source = { width: 1920, height: 1080 };
  const frame = frameOnStage({ width: 1000, height: 450 }, source, NO_EDITS, { even: true });

  test("is in the source's pixels, whichever way it was dragged, and stays on the picture", () => {
    const [a, b] = [sourcePoint(frame, source, 50, 225), sourcePoint(frame, source, 800 * 0.75, 450)];
    expect(boxBetween(b, a)).toEqual({ x: 120, y: 540, width: 1320, height: 540 });
    expect(sourcePoint(frame, source, -80, -30)).toEqual({ x: 0, y: 0 });
  });

  test("maps back to where it was drawn through the straightening and the turn", () => {
    const straightened = frameOnStage({ width: 900, height: 900 }, source, { ...NO_EDITS, crop: { x: 200, y: 100, width: 1200, height: 800 }, straighten: 7, turn: 270 }, { even: true });
    const point = sourcePoint(straightened, source, 300, 400);
    const back = [straightened.toScreen.a * point.x + straightened.toScreen.c * point.y + straightened.toScreen.e, straightened.toScreen.b * point.x + straightened.toScreen.d * point.y + straightened.toScreen.f];
    expect(back[0]).toBeCloseTo(300, 6);
    expect(back[1]).toBeCloseTo(400, 6);
  });
});

test("the view bundles into one self-contained file with its styles", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "media-view-"));
  try {
    await buildView(outdir);
    expect(await readdir(outdir)).toEqual(["view.js"]);
    const js = await Bun.file(join(outdir, "view.js")).text();
    expect(js).not.toMatch(/\bfrom\s*["']/);
    expect(js).not.toMatch(/\bimport\s*\(/);
    expect(js).toContain(".frame video");
    expect(js).toContain("mirador.onState");
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}, 60_000);

describe("the timeline's ruler", () => {
  test("names whole steps of the smallest step that fits, and none in the last half step", () => {
    expect(rulerTicks(20, 7)).toEqual([0, 5, 10, 15]);
    expect(rulerTicks(125, 4)).toEqual([0, 60]);
    expect(rulerTicks(0.3, 2)).toEqual([0]);
    expect(rulerTicks(0, 5)).toEqual([]);
  });

  test("names a time to the second, and to the tenth between seconds", () => {
    expect([0, 5, 90, 3720, 1.5].map(formatTick)).toEqual(["0:00", "0:05", "1:30", "1:02:00", "0:01.5"]);
  });
});

test("the filmstrip shows the middle of each equal part of the video", () => {
  expect(thumbnailTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
});
