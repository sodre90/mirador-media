import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { standInName } from "../shared/document.ts";
import { binaries, runProgram } from "./ffmpeg.ts";

const isUpToDate = (standIn: string, source: string) => existsSync(standIn) && statSync(standIn).mtimeMs >= statSync(source).mtimeMs;

/**
 * The PNG stand-in of a HEIF photo, decoded beside it unless it is there already and newer than the photo: no browser
 * shows HEIF. ffmpeg crops, turns and joins the photo's tiles as the file says it is shown.
 */
export async function heifStandIn(source: string, signal: AbortSignal): Promise<string> {
  const standIn = join(dirname(source), standInName(basename(source)));
  if (isUpToDate(standIn, source)) return standIn;
  const partial = `${standIn}.partial.png`;
  try {
    await runProgram(binaries.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-frames:v", "1", partial], signal);
    renameSync(partial, standIn);
  } finally {
    rmSync(partial, { force: true });
  }
  return standIn;
}
