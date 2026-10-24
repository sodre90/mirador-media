import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView } from "../scripts/build-view.ts";
import { boxBetween, boxOnScreen, pictureRect, sourcePoint } from "../view/geometry.ts";

describe("pictureRect", () => {
  test("letterboxes a wide picture in a tall element, and pillarboxes it in a wide one", () => {
    expect(pictureRect({ width: 800, height: 600 }, { width: 1920, height: 1080 })).toEqual({ left: 0, top: 75, width: 800, height: 450 });
    expect(pictureRect({ width: 1000, height: 450 }, { width: 1920, height: 1080 })).toEqual({ left: 100, top: 0, width: 800, height: 450 });
  });
});

describe("the box drawn on the screen", () => {
  const picture = pictureRect({ width: 1000, height: 450 }, { width: 1920, height: 1080 });
  const source = { width: 1920, height: 1080 };

  test("is in the source's pixels, whichever way it was dragged, and stays on the picture", () => {
    const [a, b] = [sourcePoint(picture, source, 150, 225), sourcePoint(picture, source, 100 + 800 * 0.75, 450)];
    expect(boxBetween(b, a)).toEqual({ x: 120, y: 540, width: 1320, height: 540 });
    expect(sourcePoint(picture, source, 20, -30)).toEqual({ x: 0, y: 0 });
  });

  test("shows where it was drawn", () => {
    expect(boxOnScreen(picture, source, { x: 120, y: 540, width: 1320, height: 540 })).toEqual({ left: 150, top: 225, width: 550, height: 225 });
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
    expect(js).toContain(".stage video");
    expect(js).toContain("mirador.onState");
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}, 60_000);
