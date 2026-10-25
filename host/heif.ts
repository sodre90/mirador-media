import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import decode from "heic-decode";
import { standInName } from "../shared/document.ts";
import { binaries, runProgram } from "./ffmpeg.ts";

const isUpToDate = (standIn: string, source: string) => existsSync(standIn) && statSync(standIn).mtimeMs >= statSync(source).mtimeMs;

/**
 * The PNG stand-in of a HEIF photo, decoded beside it unless it is there already and newer than the photo: the bundled
 * ffmpeg can't read HEIF, and no browser shows it. The decoder turns the picture as the file says it is shown.
 */
export async function heifStandIn(source: string, signal: AbortSignal): Promise<string> {
  const standIn = join(dirname(source), standInName(basename(source)));
  if (isUpToDate(standIn, source)) return standIn;
  const { width, height, data } = await decode({ buffer: await Bun.file(source).bytes() });
  const pixels = `${standIn}.rgba`;
  const partial = `${standIn}.partial.png`;
  try {
    await Bun.write(pixels, data);
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", pixels, "-frames:v", "1", partial], signal);
    renameSync(partial, standIn);
  } finally {
    rmSync(pixels, { force: true });
    rmSync(partial, { force: true });
  }
  return standIn;
}
