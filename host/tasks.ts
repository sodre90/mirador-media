import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AppTask, AppTaskContext } from "../mirador/api.ts";
import { isHeif, isPhoto, renderedName, type MediaDocument } from "../shared/document.ts";
import { describeEdits } from "../shared/describe.ts";
import { formatTime } from "../shared/time.ts";
import { keptPieces, resultLength } from "../shared/timeline.ts";
import { exifForRender, exifOf, withExif } from "./exif.ts";
import { heifStandIn } from "./heif.ts";
import { binaries, PHOTO_PROBE_ARGUMENTS, photoArguments, photoProbeFrom, PROBE_ARGUMENTS, probeFrom, progressSeconds, renderArguments, runProgram } from "./ffmpeg.ts";

/** The source's name, and the file ffmpeg reads of it: a HEIF photo's PNG stand-in, decoded when it isn't up to date. */
async function sourceFile({ document, file, signal }: AppTaskContext<MediaDocument>) {
  if (!document.source) throw new Error('there is no video or photo yet; name one with { op: "source", file: "clip.mp4" }');
  const path = file(document.source.file);
  if (!existsSync(path)) throw new Error(`${document.source.file} doesn't exist next to this file`);
  return { name: document.source.file, path: isHeif(path) ? await heifStandIn(path, signal) : path };
}

/** Reads the video or photo with ffprobe, and keeps what it read in the document. */
async function probed(context: AppTaskContext<MediaDocument>) {
  const { name, path } = await sourceFile(context);
  context.progress(null, `reading ${name}`);
  const [args, readFrom] = isPhoto(name) ? [PHOTO_PROBE_ARGUMENTS, photoProbeFrom] : [PROBE_ARGUMENTS, probeFrom];
  const read = readFrom(await runProgram(binaries.ffprobe, [...args, path], context.signal));
  await context.apply({ op: "probed", probe: read });
  return read;
}

export const probe: AppTask<MediaDocument> = {
  title: "Read the size, and a video's length and frame rate",
  async run(context) {
    const { width, height, duration } = await probed(context);
    const file = context.document.source!.file;
    return isPhoto(file) ? `${file} is ${width}×${height}.` : `${file} is ${width}×${height}, ${formatTime(duration)} long.`;
  },
};

/** ffmpeg writes no EXIF into a JPEG or WebP and only some of it into a PNG, so the render gets the photo's own, made right for it. */
async function carryExif(photo: string, render: string, signal: AbortSignal) {
  const exif = exifOf(await Bun.file(photo).bytes());
  if (!exif) return;
  const { width, height } = photoProbeFrom(await runProgram(binaries.ffprobe, [...PHOTO_PROBE_ARGUMENTS, render], signal));
  const fitted = exifForRender(exif, { width, height });
  if (fitted) await Bun.write(render, withExif(await Bun.file(render).bytes(), fitted));
}

/** Where the render writes until it is done, beside the file it replaces, so the old one plays until the new one is whole. */
const unfinished = (output: string) => join(dirname(output), `.${basename(output).replace(/(\.[^.]+)$/, ".rendering$1")}`);

export const render: AppTask<MediaDocument> = {
  title: "Render the edits into a file next to the source",
  async run(context) {
    const { document, apply, progress, signal } = context;
    const { name, path } = await sourceFile(context);
    const outputName = renderedName(name);
    const output = context.file(outputName);
    const partial = unfinished(output);
    const { edits } = document;
    const read = document.source!.probe ?? (await probed(context));
    const total = resultLength(keptPieces(edits, read.duration));
    progress(0, `rendering ${outputName}`);
    const started = Date.now();
    try {
      if (isPhoto(name)) {
        await runProgram(binaries.ffmpeg, photoArguments(path, partial, edits, read), signal);
        await carryExif(context.file(name), partial, signal);
      } else
        await runProgram(binaries.ffmpeg, renderArguments(path, partial, edits, read), signal, (line) => {
          const seconds = progressSeconds(line);
          if (seconds !== null && total > 0) progress(Math.min(1, seconds / total), `${formatTime(seconds)} of ${formatTime(total)}`);
        });
      renameSync(partial, output);
    } finally {
      rmSync(partial, { force: true });
    }
    await apply({ op: "rendered", file: outputName, edits });
    const took = Math.max(1, Math.round((Date.now() - started) / 1000));
    return `Rendered ${outputName} (edits: ${describeEdits(edits)}) in ${took} s; the user can compare it with ${name} in the app.`;
  },
};
