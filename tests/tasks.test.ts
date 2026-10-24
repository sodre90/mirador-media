import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaries, PROBE_ARGUMENTS, probeFrom, runProgram } from "../host/ffmpeg.ts";
import { probe, render } from "../host/tasks.ts";
import type { AppTask, AppTaskContext } from "../mirador/api.ts";
import { newDocument, type MediaDocument } from "../shared/document.ts";
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
  const decoded = Bun.spawn([binaries.ffmpeg!, "-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...new Uint8Array(await new Response(decoded.stdout).arrayBuffer()).slice(0, 3)];
};

const probed = async (file: string) => probeFrom(await runProgram(binaries.ffprobe, [...PROBE_ARGUMENTS, file], never));

/** A clip of the test pattern, or another of ffmpeg's sources, with a tone at CD audio's 44.1 kHz, which WebM's Opus can't take as it is. */
async function clipWithSound(folder: string, name: string, seconds: number, picture = "testsrc2=s=160x120:r=10") {
  const sources = ["-f", "lavfi", "-i", `${picture}:d=${seconds}`, "-f", "lavfi", "-i", `sine=f=440:r=44100:d=${seconds}`];
  await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...sources, "-c:v", "libx264", "-c:a", "aac", "-shortest", join(folder, name)], never);
}

const pixelAt = async (file: string, seconds: number) => {
  const decoded = Bun.spawn([binaries.ffmpeg!, "-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return new Uint8Array(await new Response(decoded.stdout).arrayBuffer())[0]!;
};

/** How loud a part of a file's sound is on average, in dB below full scale; ffmpeg says -91 for silence. */
const loudness = async (file: string, from: number, seconds: number) => {
  const measured = Bun.spawn([binaries.ffmpeg!, "-hide_banner", "-nostats", "-ss", String(from), "-t", String(seconds), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { stderr: "pipe" });
  const report = await new Response(measured.stderr).text();
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(report)![1]);
};

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
    expect(read.source!.probe).toEqual({ width: 64, height: 48, duration: expect.closeTo(2, 1), fps: 10, audio: false });
    expect(summary).toMatch(/^clip\.webm is 64×48, 0:0[12]\.\d\d long\.$/);
  });

  test("says when there is no video, or the file isn't there", async () => {
    const folder = mkdtempSync(join(tmpdir(), "media-probe-"));
    await expect(runTask(probe, newDocument(), folder)).rejects.toThrow("there is no video yet");
    const missing = applyOperation(newDocument(), { op: "source", file: "gone.mp4" }).document;
    await expect(runTask(probe, missing, folder)).rejects.toThrow("gone.mp4 doesn't exist next to this file");
  });
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
