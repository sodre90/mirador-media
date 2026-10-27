import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exifFacts, exifForRender, exifOf, withExif } from "../host/exif.ts";
import { binaries, PHOTO_PROBE_ARGUMENTS, photoProbeFrom, PROBE_ARGUMENTS, probeFrom, runProgram } from "../host/ffmpeg.ts";
import { probe, render } from "../host/tasks.ts";
import type { AppTask, AppTaskContext } from "../mirador/api.ts";
import { newDocument, type MediaDocument } from "../shared/document.ts";
import { framed, mapped } from "../shared/geometry.ts";
import { applyOperation } from "../shared/operations.ts";

const never = new AbortController().signal;

/** A clip with no sound from one of ffmpeg's test sources: mid-grey by default. */
async function testClip(folder: string, name: string, seconds: number, source = "color=c=0x808080:s=64x48:r=10") {
  await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `${source}:d=${seconds}`, "-c:v", "libvpx", "-b:v", "300k", join(folder, name)], never);
}

/** Runs a task as Mirador would, against a document kept here: its operations apply in turn and its progress is recorded. */
async function runTask(task: AppTask<MediaDocument>, document: MediaDocument, folder: string, { signal = never, onProgress = (_done: number | null) => {} } = {}) {
  let current = document;
  const progress: [number | null, string | undefined][] = [];
  const context: AppTaskContext<MediaDocument> = {
    document,
    file: (path) => join(folder, path),
    documentFolder: folder,
    workspaceFolder: folder,
    pluginFolder: join(import.meta.dir, ".."),
    author: { kind: "you" },
    apply: async (operation) => {
      const { document: next, summary, touched } = applyOperation(current, operation);
      current = next;
      return { seq: 1, author: { kind: "you" }, summary, touched, at: Date.now() };
    },
    progress: (done, text) => {
      progress.push([done, text]);
      onProgress(done);
    },
    signal,
  };
  const summary = await task.run(context);
  return { summary, document: current, progress };
}

const firstPixel = async (file: string) => {
  const decoded = Bun.spawn([binaries.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...new Uint8Array(await new Response(decoded.stdout).arrayBuffer()).slice(0, 3)];
};

const probed = async (file: string) => probeFrom(await runProgram(binaries.ffprobe, [...PROBE_ARGUMENTS, file], never));

/** A clip of the test pattern, or another of ffmpeg's sources, with a tone at CD audio's 44.1 kHz, which WebM's Opus can't take as it is. */
async function clipWithSound(folder: string, name: string, seconds: number, picture = "testsrc2=s=160x120:r=10") {
  const sources = ["-f", "lavfi", "-i", `${picture}:d=${seconds}`, "-f", "lavfi", "-i", `sine=f=440:r=44100:d=${seconds}`];
  await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...sources, "-c:v", "libx264", "-c:a", "aac", "-shortest", join(folder, name)], never);
}

const pixelAt = async (file: string, seconds: number) => {
  const decoded = Bun.spawn([binaries.ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return new Uint8Array(await new Response(decoded.stdout).arrayBuffer())[0]!;
};

/** How loud a part of a file's sound is on average, in dB below full scale; ffmpeg says -91 for silence. */
const loudness = async (file: string, from: number, seconds: number) => {
  const measured = Bun.spawn([binaries.ffmpeg, "-hide_banner", "-nostats", "-ss", String(from), "-t", String(seconds), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { stderr: "pipe" });
  const report = await new Response(measured.stderr).text();
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(report)![1]);
};

/** A picture's size, as its first frame shows it. */
const pictureSize = async (file: string) => photoProbeFrom(await runProgram(binaries.ffprobe, [...PHOTO_PROBE_ARGUMENTS, file], never));

/** The middle of the bright pixels of a file's first frame, and the frame's size. */
async function colourAt(file: string, x: number, y: number) {
  const decoded = Bun.spawn([binaries.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return new Uint8Array(await new Response(decoded.stdout).arrayBuffer());
}

async function brightSpot(file: string) {
  const { width, height } = await pictureSize(file);
  const decoded = Bun.spawn([binaries.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const pixels = new Uint8Array(await new Response(decoded.stdout).arrayBuffer());
  const bright = [...pixels.keys()].filter((index) => pixels[index]! > 128).map((index) => ({ x: (index % width) + 0.5, y: Math.floor(index / width) + 0.5 }));
  const middle = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return { width, height, x: middle(bright.map(({ x }) => x)), y: middle(bright.map(({ y }) => y)) };
}

const streamSeconds = async (file: string) => {
  const report = await runProgram(binaries.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,sample_rate:format=duration", "-of", "json", file], never);
  const { streams, format } = JSON.parse(report) as { streams: { codec_type: string; sample_rate?: string }[]; format: { duration: string } };
  return { duration: Number(format.duration), kinds: streams.map(({ codec_type, sample_rate }) => (sample_rate ? `${codec_type} ${sample_rate}` : codec_type)) };
};

describe("the probe task", () => {
  test("reads the video's size, length and frame rate into the document", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-probe-"));
    await testClip(folder, "clip.webm", 2);
    const document = applyOperation(newDocument(), { op: "source", file: "clip.webm" }).document;
    const { summary, document: read } = await runTask(probe, document, folder);
    expect(read.source!.probe).toEqual({ width: 64, height: 48, duration: expect.closeTo(2, 1), fps: 10, audio: false, modifiedAt: Math.round(statSync(join(folder, "clip.webm")).mtimeMs) });
    expect(summary).toMatch(/^clip\.webm is 64×48, 0:0[12]\.\d\d long\.$/);
  });

  test("says when there is no video, or the file isn't there", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-probe-"));
    await expect(runTask(probe, newDocument(), folder)).rejects.toThrow("there is no video or photo yet");
    const missing = applyOperation(newDocument(), { op: "source", file: "gone.mp4" }).document;
    await expect(runTask(probe, missing, folder)).rejects.toThrow("gone.mp4 doesn't exist next to this file");
  });
});

/**
 * A phone photo: 33×25 as stored, a white square at its top left on dark grey, with EXIF orientation 6, which turns it a
 * quarter clockwise to show it 25×33. ffmpeg can't write EXIF, so it was made with Pillow:
 * Image.new("RGB", (33, 25), (48, 48, 48)), the square drawn over [0, 0, 7, 7], saved at quality 95 with exif[0x0112] = 6.
 */
const PHONE_PHOTO = join(import.meta.dir, "fixtures", "turned.jpg");

/**
 * The phone photo as an iPhone stores one, HEIC, but 34×26 as stored: ffmpeg crops a 4:2:0 picture to even sizes, as a
 * camera's are. Made with Pillow as turned.jpg is, then macOS sips; HEIC keeps the turn as its own transform.
 */
const PHONE_HEIC = join(import.meta.dir, "fixtures", "turned.heic");

/**
 * A 1600×1200 HEIC stored as 512×512 tiles, as an iPhone stores its photos, with EXIF orientation 6: white over [0, 0,
 * 99, 99] and red over [1500, 1100, 1599, 1199] on dark grey. Made like turned.heic.
 */
const TILED_HEIC = join(import.meta.dir, "fixtures", "tiled.heic");

/**
 * 64×24 HEICs made with CoreImage: Display P3 red (1, 0, 0) over [0, 0, 31, 23] beside P3 grey 0.5, 10-bit, once in
 * Display P3 as an iPhone stores its photos, and in BT.2100 PQ and HLG, HDR, as some cameras shoot HEIF.
 */
const P3_HEIC = join(import.meta.dir, "fixtures", "p3-10bit.heic");
const HDR_HEICS = { PQ: join(import.meta.dir, "fixtures", "pq-10bit.heic"), HLG: join(import.meta.dir, "fixtures", "hlg-10bit.heic") };

/** turned.jpg as sips stores it in HEIC: 34×26 coded, with a clean aperture box that crops it to 33×25, turned a quarter clockwise. */
const ODD_HEIC = join(import.meta.dir, "fixtures", "odd.heic");

describe("a photo", () => {
  test("is read at its size as shown, its EXIF orientation taken into account, and lasts no time", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(PHONE_PHOTO, join(folder, "IMG_1.JPG"));
    const { summary, document } = await runTask(probe, applyOperation(newDocument(), { op: "source", file: "IMG_1.JPG" }).document, folder);
    expect(summary).toBe("IMG_1.JPG is 25×33.");
    expect(document.source!.probe).toEqual({ width: 25, height: 33, duration: 0, fps: 0, audio: false, modifiedAt: expect.any(Number) });
  });

  test("renders its exposure, its crop to the pixel and its turn into the same format, turned upright as browsers show it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(PHONE_PHOTO, join(folder, "IMG_1.JPG"));
    const edits = { crop: { x: 3, y: 0, width: 21, height: 15 }, turn: 90 as const, straighten: 0 };
    const operations = [{ op: "source", file: "IMG_1.JPG" }, { op: "exposure", ev: 1 }, { op: "crop", ...edits.crop }, { op: "turn", degrees: edits.turn }];
    const document = operations.reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
    const { summary } = await runTask(render, document, folder);
    expect(summary).toMatch(/^Rendered IMG_1\.edited\.JPG \(edits: exposure \+1\.00 EV; crop x 3, y 0, 21×15 px; turned 90° clockwise\) in \d+ s; the user can compare it with IMG_1\.JPG in the app\.$/);
    expect(readdirSync(folder).sort()).toEqual(["IMG_1.JPG", "IMG_1.edited.JPG"]);
    const rendered = join(folder, "IMG_1.edited.JPG");
    const { size, matrix } = framed({ width: 25, height: 33 }, edits, { even: false });
    expect(size).toEqual({ width: 15, height: 21 });
    const spot = await brightSpot(rendered);
    expect({ width: spot.width, height: spot.height }).toEqual(size);
    const expected = mapped(matrix, { x: 20.5, y: 4 });
    expect(Math.hypot(spot.x - expected.x, spot.y - expected.y)).toBeLessThan(1);
    expect(Math.abs((await firstPixel(rendered))[0]! - 96)).toBeLessThanOrEqual(8);
  }, 60_000);

  test("from an iPhone, HEIC, is read through a PNG decoded beside it, turned as it is shown, and renders as JPEG", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(PHONE_HEIC, join(folder, "IMG_2.HEIC"));
    const opened = applyOperation(newDocument(), { op: "source", file: "IMG_2.HEIC" }).document;
    const { summary, document } = await runTask(probe, opened, folder);
    expect(summary).toBe("IMG_2.HEIC is 26×34.");
    expect(readdirSync(folder).sort()).toEqual([".IMG_2.HEIC.png", "IMG_2.HEIC"]);
    const decodedAt = statSync(join(folder, ".IMG_2.HEIC.png")).mtimeMs;
    const brightened = applyOperation(document, { op: "exposure", ev: 1 }).document;
    expect((await runTask(render, brightened, folder)).summary).toMatch(/^Rendered IMG_2\.edited\.jpg \(edits: exposure \+1\.00 EV\) in \d+ s; /);
    expect(statSync(join(folder, ".IMG_2.HEIC.png")).mtimeMs).toBe(decodedAt);
    const rendered = join(folder, "IMG_2.edited.jpg");
    expect(await pictureSize(rendered)).toEqual({ width: 26, height: 34, duration: 0, fps: 0, audio: false });
    const spot = await brightSpot(rendered);
    expect(Math.hypot(spot.x - 22, spot.y - 4)).toBeLessThan(1.5);
    expect(Math.abs((await firstPixel(rendered))[0]! - 96)).toBeLessThanOrEqual(8);
  }, 60_000);

  test("from an iPhone at an odd size keeps every row and column, cropped as the file says once it is turned", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(ODD_HEIC, join(folder, "IMG_5.HEIC"));
    const { summary } = await runTask(probe, applyOperation(newDocument(), { op: "source", file: "IMG_5.HEIC" }).document, folder);
    expect(summary).toBe("IMG_5.HEIC is 25×33.");
    const spot = await brightSpot(join(folder, ".IMG_5.HEIC.png"));
    expect(Math.hypot(spot.x - 21, spot.y - 4)).toBeLessThan(1);
  });

  test("in Display P3 renders as a JPEG that keeps the profile, its colours as they were", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(P3_HEIC, join(folder, "IMG_7.HEIC"));
    await runTask(render, applyOperation(newDocument(), { op: "source", file: "IMG_7.HEIC" }).document, folder);
    const rendered = join(folder, "IMG_7.edited.jpg");
    const profileName = Buffer.from("Display P3", "utf16le").swap16();
    expect(Buffer.from(await Bun.file(rendered).bytes()).includes(profileName)).toBe(true);
    expect([...(await colourAt(rendered, 8, 8))].map((value) => Math.round(value / 8))).toEqual([32, 0, 0]);
  });

  for (const [transfer, photo] of Object.entries(HDR_HEICS)) {
    test(`in HDR, ${transfer}, is brought to SDR, its SDR white and the tones under it as they were`, async () => {
      const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
      copyFileSync(photo, join(folder, "IMG_8.HEIC"));
      await runTask(render, applyOperation(newDocument(), { op: "source", file: "IMG_8.HEIC" }).document, folder);
      const rendered = join(folder, "IMG_8.edited.jpg");
      const [red, green, blue] = await colourAt(rendered, 8, 8);
      expect(red).toBeGreaterThan(235);
      expect(Math.max(green!, blue!)).toBeLessThan(16);
      expect([...(await colourAt(rendered, 48, 8))].every((value) => Math.abs(value - 128) <= 4)).toBe(true);
    });
  }

  test("from an iPhone, stored as tiles, is read whole and upright", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    copyFileSync(TILED_HEIC, join(folder, "IMG_3.HEIC"));
    const { summary } = await runTask(probe, applyOperation(newDocument(), { op: "source", file: "IMG_3.HEIC" }).document, folder);
    expect(summary).toBe("IMG_3.HEIC is 1200×1600.");
    const spot = await brightSpot(join(folder, ".IMG_3.HEIC.png"));
    expect(Math.hypot(spot.x - 1150, spot.y - 50)).toBeLessThan(1.5);
  });

  test("from an iPhone is decoded again once the photo changes", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    const photo = join(folder, "IMG_2.HEIC");
    copyFileSync(PHONE_HEIC, photo);
    const opened = applyOperation(newDocument(), { op: "source", file: "IMG_2.HEIC" }).document;
    await runTask(probe, opened, folder);
    const standIn = join(folder, ".IMG_2.HEIC.png");
    utimesSync(standIn, new Date(0), new Date(0));
    await runTask(probe, opened, folder);
    expect(statSync(standIn).mtimeMs).toBeGreaterThan(statSync(photo).mtimeMs - 1);
  });

  test("keeps a PNG as PNG and a WebP as WebP", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-photo-"));
    for (const name of ["shot.png", "shot.webp"]) {
      await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=32x18,format=rgb24,crop=31:17:0:0", "-frames:v", "1", join(folder, name)], never);
      const document = [{ op: "source", file: name }, { op: "exposure", ev: 1 }].reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
      await runTask(render, document, folder);
      const output = join(folder, name.replace(".", ".edited."));
      const codec = await runProgram(binaries.ffprobe, ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", output], never);
      expect([codec.trim(), await pictureSize(output)]).toEqual([name.endsWith(".png") ? "png" : "webp", { width: 31, height: 17, duration: 0, fps: 0, audio: false }]);
      expect(Math.abs((await firstPixel(output))[0]! - 128)).toBeLessThanOrEqual(4);
    }
  }, 60_000);
});

describe("a photo's render", () => {
  const CAMERA_JPEG = join(import.meta.dir, "fixtures", "camera.jpg");
  const CAMERA_HEIC = join(import.meta.dir, "fixtures", "camera.heic");
  const asTaken = { make: "Apple", model: "iPhone 15", taken: "2026:10:25 12:00:00", hasPlace: true, hasThumbnail: false };
  const cropped = [{ op: "crop", x: 0, y: 0, width: 20, height: 30 }];

  /** camera.jpg as PNG or WebP, upright, with its EXIF saying so. */
  async function uprightCopy(folder: string, name: string) {
    const path = join(folder, name);
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", CAMERA_JPEG, "-frames:v", "1", ...(name.endsWith(".webp") ? ["-c:v", "libwebp"] : []), path], never);
    const exif = exifForRender(exifOf(await Bun.file(CAMERA_JPEG).bytes())!, { width: 30, height: 40 })!;
    await Bun.write(path, withExif(await Bun.file(path).bytes(), exif));
  }

  test("still comes out when the photo's EXIF can't be read, and the summary says it has none", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-exif-"));
    const photo = await Bun.file(CAMERA_JPEG).bytes();
    const tiffStart = Buffer.from(photo).indexOf("Exif\0\0") + 6;
    photo.set([0x58, 0x58], tiffStart);
    await Bun.write(join(folder, "IMG_6.JPG"), photo);
    const document = [{ op: "source", file: "IMG_6.JPG" }, ...cropped].reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
    const { summary } = await runTask(render, document, folder);
    expect(summary).toMatch(/^Rendered IMG_6\.edited\.JPG \(edits: crop x 0, y 0, 20×30 px\) in \d+ s; its EXIF couldn't be read, so the render has none; the user can compare it with IMG_6\.JPG in the app\.$/);
    expect(exifOf(await Bun.file(join(folder, "IMG_6.edited.JPG")).bytes())).toBeNull();
  }, 60_000);

  for (const [name, rendered] of [["IMG_4.JPG", "IMG_4.edited.JPG"], ["IMG_4.HEIC", "IMG_4.edited.jpg"], ["shot.png", "shot.edited.png"], ["shot.webp", "shot.edited.webp"]] as const) {
    test(`from ${name} keeps when and where it was taken and the camera, upright and at its new size`, async () => {
      const folder = mkdtempSync(join(tmpdir(), "media-exif-"));
      if (name.endsWith(".JPG")) copyFileSync(CAMERA_JPEG, join(folder, name));
      else if (name.endsWith(".HEIC")) copyFileSync(CAMERA_HEIC, join(folder, name));
      else await uprightCopy(folder, name);
      const document = [{ op: "source", file: name }, ...cropped].reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
      await runTask(render, document, folder);
      const output = join(folder, rendered);
      expect(await pictureSize(output)).toEqual({ width: 20, height: 30, duration: 0, fps: 0, audio: false });
      expect(exifFacts(exifOf(await Bun.file(output).bytes())!)).toEqual({ orientation: 1, ...asTaken, size: { width: 20, height: 30 } });
    }, 60_000);
  }
});

describe("the render task", () => {
  test("renders the trim and the exposure next to the source, as the preview shows them, and the document records it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await testClip(folder, "clip.webm", 4);
    const document = [{ op: "source", file: "clip.webm" }, { op: "trim", start: 1, end: 3 }, { op: "exposure", ev: -1 }].reduce(
      (edited, operation) => applyOperation(edited, operation).document,
      newDocument(),
    );
    const { summary, document: rendered, progress } = await runTask(render, document, folder);
    expect(summary).toMatch(/^Rendered clip\.edited\.webm \(edits: trim 0:01\.00–0:03\.00; exposure -1\.00 EV\) in \d+ s; the user can compare it with clip\.webm in the app\.$/);
    expect(readdirSync(folder).sort()).toEqual(["clip.edited.webm", "clip.webm"]);
    expect((await probed(join(folder, "clip.edited.webm"))).duration).toBeCloseTo(2, 0);
    const [red, green, blue] = await firstPixel(join(folder, "clip.edited.webm"));
    for (const channel of [red, green, blue]) expect(Math.abs(channel! - 64)).toBeLessThanOrEqual(8);
    expect(rendered.rendered).toMatchObject({ file: "clip.edited.webm", edits: { trim: { start: 1, end: 3 }, exposure: { clip: -1, ranges: [] } } });
    expect(rendered.source!.probe).not.toBeNull();
    expect(progress[0]).toEqual([null, "reading clip.webm"]);
    expect(progress.at(-1)![0]).toBeGreaterThan(0.5);
  }, 60_000);

  test("cuts parts out of a video with sound, keeping the sound, into a WebM and an MP4 alike", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await clipWithSound(folder, "clip.mp4", 10);
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", join(folder, "clip.mp4"), "-c:v", "libvpx", "-c:a", "libvorbis", "-ar", "44100", join(folder, "talk.webm")], never);
    for (const [name, rendered, sound] of [["clip.mp4", "clip.edited.mp4", "audio 44100"], ["talk.webm", "talk.edited.webm", "audio 48000"]] as const) {
      const document = [{ op: "source", file: name }, { op: "trim", start: 1, end: 9 }, { op: "cut", start: 3, end: 5 }].reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
      const { summary } = await runTask(render, document, folder);
      expect(summary).toContain(`Rendered ${rendered} (edits: trim 0:01.00–0:09.00; cut 0:03.00–0:05.00)`);
      const { duration, kinds } = await streamSeconds(join(folder, rendered));
      expect(duration).toBeCloseTo(6, 1);
      expect(kinds).toEqual(["video", sound]);
    }
  }, 60_000);

  test("plays each range at its own speed, volume and exposure, as the preview does", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await clipWithSound(folder, "clip.mp4", 10, "color=c=0x808080:s=64x48:r=10");
    const operations = [
      { op: "source", file: "clip.mp4" },
      { op: "speed", rate: 2, start: 2, end: 4 },
      { op: "volume", level: 0, start: 6, end: 8 },
      { op: "exposure", ev: -1, start: 8, end: 10 },
    ];
    const document = operations.reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
    await runTask(render, document, folder);
    const output = join(folder, "clip.edited.mp4");
    expect((await streamSeconds(output)).duration).toBeCloseTo(9, 1);
    expect(await loudness(output, 3.2, 1.6)).toBeGreaterThan(-30);
    expect(await loudness(output, 5.2, 1.6)).toBeLessThan(-80);
    expect(Math.abs((await pixelAt(output, 1)) - 128)).toBeLessThanOrEqual(8);
    expect(Math.abs((await pixelAt(output, 8)) - 64)).toBeLessThanOrEqual(8);
  }, 60_000);

  test("crops, straightens and turns the frame so that a spot lands where the preview's matrix puts it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    const spotted = "color=c=black:s=320x240:r=10:d=1,drawbox=x=200:y=70:w=8:h=8:color=white:t=fill";
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", spotted, "-c:v", "libvpx", "-b:v", "1M", join(folder, "clip.webm")], never);
    const edits = { crop: { x: 60, y: 41, width: 201, height: 160 }, turn: 90 as const, straighten: 10 };
    const operations = [{ op: "source", file: "clip.webm" }, { op: "crop", ...edits.crop }, { op: "straighten", degrees: edits.straighten }, { op: "turn", degrees: edits.turn }];
    const document = operations.reduce((edited, operation) => applyOperation(edited, operation).document, newDocument());
    await runTask(render, document, folder);
    const spot = await brightSpot(join(folder, "clip.edited.webm"));
    const { size, matrix } = framed({ width: 320, height: 240 }, edits, { even: true });
    const expected = mapped(matrix, { x: 204, y: 74 });
    expect({ width: spot.width, height: spot.height }).toEqual(size);
    expect(size).toEqual({ width: 160, height: 200 });
    expect(Math.hypot(spot.x - expected.x, spot.y - expected.y)).toBeLessThan(1.5);
  }, 60_000);

  test("writes an MP4 for any other source, and replaces the one rendered before", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await testClip(folder, "clip.webm", 1);
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", join(folder, "clip.webm"), "-c:v", "libx264", join(folder, "clip.mov")], never);
    const document = applyOperation(newDocument(), { op: "source", file: "clip.mov" }).document;
    await runTask(render, document, folder);
    const brighter = applyOperation(document, { op: "exposure", ev: 0.5 }).document;
    await runTask(render, brighter, folder);
    expect(readdirSync(folder).sort()).toEqual(["clip.edited.mp4", "clip.mov", "clip.webm"]);
    const [red] = await firstPixel(join(folder, "clip.edited.mp4"));
    expect(Math.abs(red! - Math.round(128 * Math.SQRT2))).toBeLessThanOrEqual(8);
  }, 60_000);

  test("stops ffmpeg when the user stops it part of the way, and leaves nothing half written", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await testClip(folder, "clip.webm", 60, "testsrc2=s=320x240:r=25");
    const opened = applyOperation(applyOperation(newDocument(), { op: "source", file: "clip.webm" }).document, { op: "exposure", ev: 1 }).document;
    const { document } = await runTask(probe, opened, folder);
    const stopping = new AbortController();
    const stoppedPartWay = (done: number | null) => done !== null && done > 0 && stopping.abort();
    await expect(runTask(render, document, folder, { signal: stopping.signal, onProgress: stoppedPartWay })).rejects.toThrow("stopped");
    expect(stopping.signal.aborted).toBe(true);
    expect(readdirSync(folder)).toEqual(["clip.webm"]);
  }, 60_000);

  test("doesn't start ffmpeg when it was stopped before it began", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-render-"));
    await testClip(folder, "clip.webm", 1);
    const { document } = await runTask(probe, applyOperation(newDocument(), { op: "source", file: "clip.webm" }).document, folder);
    await expect(runTask(render, document, folder, { signal: AbortSignal.abort() })).rejects.toThrow("stopped");
    expect(readdirSync(folder)).toEqual(["clip.webm"]);
  });
});
