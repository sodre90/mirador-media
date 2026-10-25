import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { standInName } from "../shared/document.ts";
import { binaries, runProgram } from "./ffmpeg.ts";

const isUpToDate = (standIn: string, source: string) => existsSync(standIn) && statSync(standIn).mtimeMs >= statSync(source).mtimeMs;

export interface StoredCrop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const SHOWN_PROBE_ARGUMENTS = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer:stream_side_data=crop_top,crop_bottom,crop_left,crop_right,rotation,displaymatrix", "-of", "json"];

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

/**
 * An HDR photo, PQ or HLG as some cameras shoot HEIF, brought to SDR for browsers and for the JPEG render, which would
 * otherwise mark the HDR values as sRGB. SDR white stays white and the tones under it as they are; brighter highlights
 * roll off instead of clipping.
 */
const TO_SDR = ["zscale=t=linear:npl=203", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=mobius:param=0.8:desat=0", "zscale=t=iec61966-2-1:m=bt709:r=pc"];

/** Whether ffprobe's report is of an HDR picture. */
export const isHdrFrom = (report: string) => HDR_TRANSFERS.has((JSON.parse(report) as { streams?: { color_transfer?: string }[] }).streams?.[0]?.color_transfer ?? "");

interface ProbedSideData {
  crop_top?: number;
  crop_bottom?: number;
  crop_left?: number;
  crop_right?: number;
  rotation?: number;
  displaymatrix?: string;
}

/** A display matrix that mirrors the picture as well as turning it, which the crop below doesn't follow. */
function mirrors(displaymatrix: string) {
  const [a, b, , c, d] = displaymatrix.split("\n").flatMap((row) => row.split(":")[1]?.trim().split(/\s+/).map(Number) ?? []);
  return a! * d! - b! * c! < 0;
}

/** The crop that HEIF's clean aperture box asks for, and how far clockwise the photo is turned to be shown, or null to leave both to ffmpeg. */
export function storedCropFrom(report: string): { crop: StoredCrop; clockwise: number } | null {
  const sideData = (JSON.parse(report) as { streams?: { side_data_list?: ProbedSideData[] }[] }).streams?.[0]?.side_data_list ?? [];
  const cropping = sideData.find((data) => data.crop_top !== undefined);
  const display = sideData.find((data) => data.rotation !== undefined);
  if (!cropping) return null;
  if (display?.displaymatrix && mirrors(display.displaymatrix)) return null;
  const clockwise = (((-(display?.rotation ?? 0)) % 360) + 360) % 360;
  return { crop: { top: cropping.crop_top ?? 0, bottom: cropping.crop_bottom ?? 0, left: cropping.crop_left ?? 0, right: cropping.crop_right ?? 0 }, clockwise };
}

/** The stored crop's edges in the picture as shown, turned with it. */
export function shownCrop({ top, bottom, left, right }: StoredCrop, clockwise: number): StoredCrop {
  if (clockwise === 90) return { top: left, right: top, bottom: right, left: bottom };
  if (clockwise === 180) return { top: bottom, right: left, bottom: top, left: right };
  if (clockwise === 270) return { top: right, right: bottom, bottom: left, left: top };
  return { top, bottom, left, right };
}

/**
 * How ffmpeg decodes the photo into its stand-in. ffmpeg's own clean-aperture crop rounds a 4:2:0 picture to even
 * sizes, losing a row and a column of an odd-sized photo, so the stand-in takes only the codec's crop from it and makes
 * the rest exactly, once the photo is turned.
 */
async function decodeArguments(source: string, output: string, signal: AbortSignal) {
  const report = await runProgram(binaries.ffprobe, [...SHOWN_PROBE_ARGUMENTS, source], signal);
  const stored = storedCropFrom(report);
  const toSdr = isHdrFrom(report) ? TO_SDR : [];
  const exactCrop = stored ? [exactCropFilter(shownCrop(stored.crop, stored.clockwise))] : [];
  const filters = [...toSdr, ...(toSdr.length > 0 || stored ? ["format=rgb24"] : []), ...exactCrop];
  return [
    ...["-hide_banner", "-loglevel", "error", "-y", ...(stored ? ["-apply_cropping", "codec"] : []), "-i", source],
    ...(filters.length > 0 ? ["-vf", filters.join(",")] : []),
    ...["-frames:v", "1", output],
  ];
}

const exactCropFilter = ({ top, bottom, left, right }: StoredCrop) => `crop=exact=1:w=iw-${left + right}:h=ih-${top + bottom}:x=${left}:y=${top}`;

/**
 * The PNG stand-in of a HEIF photo, decoded beside it unless it is there already and newer than the photo: no browser
 * shows HEIF. ffmpeg turns the photo and joins its tiles as the file says it is shown.
 */
export async function heifStandIn(source: string, signal: AbortSignal): Promise<string> {
  const standIn = join(dirname(source), standInName(basename(source)));
  if (isUpToDate(standIn, source)) return standIn;
  const partial = `${standIn}.partial.png`;
  try {
    await runProgram(binaries.ffmpeg, await decodeArguments(source, partial, signal), signal);
    renameSync(partial, standIn);
  } finally {
    rmSync(partial, { force: true });
  }
  return standIn;
}
