import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exifFacts, exifForRender, exifOf, withExif } from "../host/exif.ts";
import { binaries, runProgram } from "../host/ffmpeg.ts";

/**
 * A 40×30 JPEG as a phone takes one, with EXIF orientation 6, made with Pillow: Make "Apple", Model "iPhone 15",
 * DateTimeOriginal "2026:10:25 12:00:00", PixelXDimension 40 and PixelYDimension 30, and a GPS IFD at 47°30' N 19°2' E.
 */
const CAMERA_JPEG = join(import.meta.dir, "fixtures", "camera.jpg");

/** camera.jpg as macOS sips stores it in HEIC, its EXIF as a HEIF item. */
const CAMERA_HEIC = join(import.meta.dir, "fixtures", "camera.heic");

const never = new AbortController().signal;
const cameraExif = async () => exifOf(await Bun.file(CAMERA_JPEG).bytes())!;

const asTaken = { make: "Apple", model: "iPhone 15", taken: "2026:10:25 12:00:00", hasPlace: true };

async function pictureIn(extension: string) {
  const path = join(mkdtempSync(join(tmpdir(), "media-exif-")), `picture.${extension}`);
  const format = extension === "webp" ? ["-c:v", "libwebp"] : [];
  await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=30x40", "-frames:v", "1", ...format, path], never);
  return { path, bytes: await Bun.file(path).bytes() };
}

const decodes = (path: string) => runProgram(binaries.ffmpeg, ["-v", "error", "-i", path, "-f", "null", "-"], never);

/** A little-endian TIFF block with orientation 6 in its first IFD and a second, empty IFD after it, where a thumbnail goes. */
function withThumbnailIfd() {
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 4);
  const data = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 42, 0]);
  data.setUint32(4, 8, true);
  data.setUint16(8, 1, true);
  data.setUint16(10, 0x0112, true);
  data.setUint16(12, 3, true);
  data.setUint32(14, 1, true);
  data.setUint16(18, 6, true);
  data.setUint32(22, 26, true);
  return tiff;
}

describe("a photo's EXIF", () => {
  test("is read from a JPEG and from an iPhone's HEIC alike", async () => {
    for (const photo of [CAMERA_JPEG, CAMERA_HEIC]) {
      expect(exifFacts(exifOf(await Bun.file(photo).bytes())!)).toEqual({ orientation: 6, ...asTaken, size: { width: 40, height: 30 }, hasThumbnail: false });
    }
  });

  test("is made upright for the render, at the render's size", async () => {
    expect(exifFacts(exifForRender(await cameraExif(), { width: 21, height: 33 })!)).toEqual({ orientation: 1, ...asTaken, size: { width: 21, height: 33 }, hasThumbnail: false });
  });

  test("loses its thumbnail in the render, which would show the photo unedited", () => {
    const tiff = withThumbnailIfd();
    expect(exifFacts(tiff)!.hasThumbnail).toBe(true);
    expect(exifFacts(exifForRender(tiff, { width: 1, height: 1 })!)).toMatchObject({ orientation: 1, hasThumbnail: false });
  });

  for (const extension of ["jpg", "png", "webp"]) {
    test(`goes into a ${extension} render, once, which still decodes and reads it back`, async () => {
      const { path, bytes } = await pictureIn(extension);
      const exif = exifForRender(await cameraExif(), { width: 30, height: 40 })!;
      const twice = withExif(withExif(bytes, exif), exif);
      await Bun.write(path, twice);
      await decodes(path);
      expect(exifFacts(exifOf(twice)!)).toEqual({ orientation: 1, ...asTaken, size: { width: 30, height: 40 }, hasThumbnail: false });
      const blocks = new TextDecoder("latin1").decode(twice).split("iPhone 15").length - 1;
      expect(blocks).toBe(1);
    });
  }

  test("turns a simple WebP into an extended one that states its canvas", async () => {
    const { bytes } = await pictureIn("webp");
    expect(new TextDecoder().decode(bytes.subarray(12, 16))).not.toBe("VP8X");
    const written = withExif(bytes, await cameraExif());
    const data = new DataView(written.buffer);
    expect(new TextDecoder().decode(written.subarray(12, 16))).toBe("VP8X");
    expect(data.getUint32(4, true)).toBe(written.length - 8);
    const canvas = (at: number) => written[at]! | (written[at + 1]! << 8) | (written[at + 2]! << 16);
    expect([canvas(24) + 1, canvas(27) + 1]).toEqual([30, 40]);
  });

  test("is none in a picture without it, and in what isn't a photo", async () => {
    const { bytes } = await pictureIn("jpg");
    expect(exifOf(bytes)).toBeNull();
    expect(exifOf(new TextEncoder().encode("not a photo"))).toBeNull();
    expect(exifFacts(new TextEncoder().encode("XXnot a tiff"))).toBeNull();
  });

  test("too big for a JPEG segment leaves the JPEG as it was", async () => {
    const { bytes } = await pictureIn("jpg");
    const huge = new Uint8Array(70_000);
    huge.set((await cameraExif()).subarray(0, 64));
    expect(withExif(bytes, huge)).toBe(bytes);
  });
});
