import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AppTask, AppTaskContext } from "../mirador/api.ts";
import { renderedName, type MediaDocument } from "../shared/document.ts";
import { describeEdits } from "../shared/describe.ts";
import { formatTime } from "../shared/time.ts";
import { binaries, keptSeconds, PROBE_ARGUMENTS, probeFrom, progressSeconds, renderArguments, runProgram } from "./ffmpeg.ts";

function sourceFile({ document, file }: AppTaskContext<MediaDocument>) {
  if (!document.source) throw new Error('there is no video yet; name one with { op: "source", file: "clip.mp4" }');
  const path = file(document.source.file);
  if (!existsSync(path)) throw new Error(`${document.source.file} doesn't exist next to this file`);
  return { name: document.source.file, path };
}

/** Reads the video with ffprobe, and keeps what it read in the document. */
async function probed(context: AppTaskContext<MediaDocument>) {
  const { name, path } = sourceFile(context);
  context.progress(null, `reading ${name}`);
  const read = probeFrom(await runProgram(binaries.ffprobe, [...PROBE_ARGUMENTS, path], context.signal));
  await context.apply({ op: "probed", probe: read });
  return read;
}

export const probe: AppTask<MediaDocument> = {
  title: "Read the video's size, length and frame rate",
  async run(context) {
    const { width, height, duration } = await probed(context);
    return `${context.document.source!.file} is ${width}×${height}, ${formatTime(duration)} long.`;
  },
};

/** Where the render writes until it is done, beside the file it replaces, so the old one plays until the new one is whole. */
const unfinished = (output: string) => join(dirname(output), `.${basename(output).replace(/(\.[^.]+)$/, ".rendering$1")}`);

export const render: AppTask<MediaDocument> = {
  title: "Render the edits into a file next to the video",
  async run(context) {
    const { document, apply, progress, signal } = context;
    const { name, path } = sourceFile(context);
    const outputName = renderedName(name);
    const output = context.file(outputName);
    const partial = unfinished(output);
    const { edits } = document;
    const { duration } = document.source!.probe ?? (await probed(context));
    const total = keptSeconds(edits, duration);
    progress(0, `rendering ${outputName}`);
    const started = Date.now();
    try {
      await runProgram(binaries.ffmpeg, renderArguments(path, partial, edits), signal, (line) => {
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
